#!/usr/bin/env node
// Local-only multi-connection contracts. Creates random synthetic fixtures,
// removes them in finally, and never applies migrations or reads hosted secrets.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(
  execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(),
  'pika',
)

const tag = `assignment_creation_${randomUUID().replaceAll('-', '').slice(0, 8)}`
const owner = randomUUID()
const successor = randomUUID()
const classroom = randomUUID()
const sessions = []

function adminSql(sql) {
  return execFileSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8' }).trim()
}

class Session {
  constructor(name) {
    this.name = `ac_${tag.slice(-8)}_${name}`
    this.output = ''
    this.errors = ''
    this.pending = null
    this.closed = false
    this.child = spawn('docker', [
      'exec', '-i', '-e', `PGAPPNAME=${this.name}`, container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt',
      '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose',
    ])
    this.child.stdout.on('data', (chunk) => {
      this.output += chunk.toString()
      if (this.pending && this.output.includes(this.pending.marker)) {
        const result = this.output.slice(0, this.output.indexOf(this.pending.marker)).trim()
        const pending = this.pending
        this.pending = null
        clearTimeout(pending.timer)
        pending.resolve(result)
      }
    })
    this.child.stderr.on('data', (chunk) => { this.errors += chunk.toString() })
    this.child.stdin.on('error', (error) => this.fail(error))
    this.child.on('error', (error) => this.fail(error))
    this.done = new Promise((resolve) => this.child.on('close', (code) => {
      this.closed = true
      this.fail(new Error(`${this.name} exited ${code}: ${this.errors}`))
      resolve()
    }))
    sessions.push(this)
  }

  fail(error) {
    if (!this.pending) return
    clearTimeout(this.pending.timer)
    this.pending.reject(error)
    this.pending = null
  }

  run(sql) {
    assert(!this.pending && !this.closed, 'Session must be idle and open')
    this.output = ''
    this.errors = ''
    const marker = `done_${randomUUID()}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Session timeout: ${this.name}`)), 20_000)
      this.pending = { marker, resolve, reject, timer }
      this.child.stdin.write(`${sql}\n\\echo ${marker}\n`)
    })
  }

  async close() {
    if (!this.closed) this.child.stdin.end('ROLLBACK;\n\\q\n')
    await this.done
  }
}

const observer = new Session('observer')

async function waitBlocked(waiter, blocker) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const blocked = await observer.run(`select exists (
      select 1 from pg_stat_activity as waiting, pg_stat_activity as holding
      where waiting.application_name = '${waiter.name}'
        and holding.application_name = '${blocker.name}'
        and waiting.wait_event_type = 'Lock'
        and holding.pid = any(pg_blocking_pids(waiting.pid))
    );`)
    if (blocked === 't') return
    if (!waiter.pending) throw new Error(`${waiter.name} completed before blocking`)
    await delay(50)
  }
  throw new Error(`Expected ${waiter.name} to block on ${blocker.name}`)
}

function creationSql(actor, title) {
  return `set role service_role;
    select result->'assignment'->>'id'
    from (select public.create_assignment_for_owner_v1(
      '${actor}', '${classroom}', '${title}', '', 'Instructions',
      '{"type":"doc","content":[]}'::jsonb,
      clock_timestamp() + interval '7 days', '[]'::jsonb
    ) as result) as creation;
    reset role;`
}

try {
  assert.equal(adminSql(`select exists (
    select 1 from supabase_migrations.schema_migrations where version = '192'
  );`), 't', 'Migration 192 must already be applied')

  adminSql(`
    insert into public.users (id, email, role) values
      ('${owner}', '${tag}-owner@example.invalid', 'student'),
      ('${successor}', '${tag}-successor@example.invalid', 'teacher');
    set role service_role;
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), subject_id, 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 10, 'test:migration-192', '${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = subject_id and feature_key = 'classrooms.create'), 0)
    )
    from (values ('${owner}'::uuid), ('${successor}'::uuid)) as subjects(subject_id);
    reset role;
    insert into public.classrooms (id, teacher_id, title, class_code)
    values ('${classroom}', '${owner}', '${tag}', upper(substr(replace('${classroom}', '-', ''), 1, 8)));
  `)

  const transfer = new Session('transfer_wins')
  const deniedCreation = new Session('creation_loses')
  await transfer.run(`begin; update public.classrooms set teacher_id = '${successor}' where id = '${classroom}';`)
  const denied = deniedCreation.run(`begin; set role service_role;
    do $block$ begin
      perform public.create_assignment_for_owner_v1(
        '${owner}', '${classroom}', 'Must not exist', '', 'Instructions',
        '{"type":"doc","content":[]}'::jsonb,
        clock_timestamp() + interval '7 days', '[]'::jsonb
      );
      raise exception 'Expected transferred owner denial';
    exception when insufficient_privilege then null;
    end $block$;
    reset role; select 'denied';`)
  await waitBlocked(deniedCreation, transfer)
  await transfer.run('commit;')
  assert.equal(await denied, 'denied')
  await deniedCreation.run('rollback;')
  assert.equal(adminSql(`select count(*) from public.assignments where classroom_id = '${classroom}';`), '0')
  console.log('Passed: owner_transfer_wins_assignment_creation')

  adminSql(`update public.classrooms set teacher_id = '${owner}' where id = '${classroom}';`)

  const creation = new Session('creation_wins')
  const blockedTransfer = new Session('transfer_loses')
  const createdId = await creation.run(`begin; ${creationSql(owner, 'Creation wins')}`)
  const transferred = blockedTransfer.run(`begin; update public.classrooms
    set teacher_id = '${successor}' where id = '${classroom}'; select 'transferred';`)
  await waitBlocked(blockedTransfer, creation)
  await creation.run('commit;')
  assert.equal(await transferred, 'transferred')
  await blockedTransfer.run('commit;')
  assert.equal(adminSql(`select created_by from public.assignments where id = '${createdId}';`), owner)
  assert.equal(adminSql(`select teacher_id from public.classrooms where id = '${classroom}';`), successor)
  console.log('Passed: assignment_creation_wins_owner_transfer')

  adminSql(`update public.classrooms set teacher_id = '${owner}' where id = '${classroom}';`)

  const first = new Session('first_creation')
  const second = new Session('second_creation')
  const firstId = await first.run(`begin; ${creationSql(owner, 'First serialized')}`)
  const secondResult = second.run(`begin; ${creationSql(owner, 'Second serialized')}`)
  await waitBlocked(second, first)
  await first.run('commit;')
  const secondId = await secondResult
  await second.run('commit;')
  assert.equal(adminSql(`select count(distinct position) from public.assignments
    where id in ('${firstId}', '${secondId}');`), '2')
  assert.equal(adminSql(`select max(position) - min(position) from public.assignments
    where id in ('${firstId}', '${secondId}');`), '1')
  console.log('Passed: concurrent_assignment_creations_serialize_positions')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  adminSql(`
    delete from public.classrooms where id = '${classroom}';
    delete from public.effective_feature_entitlement_audit
    where subject_user_id in ('${owner}', '${successor}');
    delete from public.users where id in ('${owner}', '${successor}');
  `)
}
