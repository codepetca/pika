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

const tag = `owner_mutation_${randomUUID().replaceAll('-', '').slice(0, 8)}`
const owner = randomUUID()
const successor = randomUUID()
const classroom = randomUUID()
const assignment = randomUUID()
const sessions = []

function adminSql(sql) {
  return execFileSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8' }).trim()
}

class Session {
  constructor(name) {
    this.name = `om_${tag.slice(-8)}_${name}`
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

function ownerUpdateSql(title) {
  return `set role service_role;
    select result->'assignment'->>'title'
    from (select public.update_assignment_for_owner_v1(
      '${owner}', '${assignment}', jsonb_build_object('title', '${title}'), null
    ) as result) as mutation;
    reset role;`
}

try {
  assert.equal(adminSql(`select exists (
    select 1 from supabase_migrations.schema_migrations where version = '191'
  );`), 't', 'Migration 191 must already be applied')

  adminSql(`
    insert into public.users (id, email, role) values
      ('${owner}', '${tag}-owner@example.invalid', 'student'),
      ('${successor}', '${tag}-successor@example.invalid', 'teacher');
    set role service_role;
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${owner}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 2, 'test:migration-191', '${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = '${owner}' and feature_key = 'classrooms.create'), 0)
    );
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${successor}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 2, 'test:migration-191', '${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = '${successor}' and feature_key = 'classrooms.create'), 0)
    );
    reset role;
    insert into public.classrooms (id, teacher_id, title, class_code)
    values ('${classroom}', '${owner}', '${tag}', upper(substr(replace('${classroom}', '-', ''), 1, 8)));
    insert into public.assignments (
      id, classroom_id, title, description, due_at, created_by, is_draft
    ) values (
      '${assignment}', '${classroom}', 'Initial', '', clock_timestamp() + interval '7 days', '${owner}', true
    );
  `)

  const transfer = new Session('transfer_wins')
  const deniedMutation = new Session('mutation_loses')
  await transfer.run(`begin; update public.classrooms set teacher_id = '${successor}' where id = '${classroom}';`)
  const denied = deniedMutation.run(`begin; set role service_role;
    do $block$ begin
      perform public.update_assignment_for_owner_v1(
        '${owner}', '${assignment}', '{"title":"must not win"}'::jsonb, null
      );
      raise exception 'Expected transferred owner denial';
    exception when insufficient_privilege then null;
    end $block$;
    reset role; select 'denied';`)
  await waitBlocked(deniedMutation, transfer)
  await transfer.run('commit;')
  assert.equal(await denied, 'denied')
  await deniedMutation.run('rollback;')
  assert.equal(adminSql(`select title from public.assignments where id = '${assignment}';`), 'Initial')
  console.log('Passed: owner_transfer_wins_assignment_mutation')

  adminSql(`update public.classrooms set teacher_id = '${owner}', archived_at = null where id = '${classroom}';`)

  const mutation = new Session('mutation_wins')
  const archive = new Session('archive_loses')
  assert.equal(await mutation.run(`begin; ${ownerUpdateSql('Mutation wins')}`), 'Mutation wins')
  const archived = archive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}'; select 'archived';`)
  await waitBlocked(archive, mutation)
  await mutation.run('commit;')
  assert.equal(await archived, 'archived')
  await archive.run('commit;')
  assert.equal(adminSql(`select title from public.assignments where id = '${assignment}';`), 'Mutation wins')
  assert.equal(adminSql(`select archived_at is not null from public.classrooms where id = '${classroom}';`), 't')
  console.log('Passed: assignment_mutation_wins_archive')

  adminSql(`
    update public.classrooms set archived_at = null where id = '${classroom}';
    update public.assignments set is_draft = true, released_at = null, due_at = clock_timestamp() + interval '7 days'
    where id = '${assignment}';
  `)

  const clockBlocker = new Session('clock_blocker')
  const scheduledRelease = new Session('clock_release')
  await clockBlocker.run(`begin; select id from public.classrooms where id = '${classroom}' for update;`)
  const releaseResult = scheduledRelease.run(`begin; set role service_role;
    select result->>'error_code'
    from (select public.release_assignment_for_owner_v1(
      '${owner}', '${assignment}', clock_timestamp() + interval '500 milliseconds', true
    ) as result) as released;
    reset role;`)
  await waitBlocked(scheduledRelease, clockBlocker)
  await delay(750)
  await clockBlocker.run('commit;')
  assert.equal(await releaseResult, 'assignment_release_not_future')
  await scheduledRelease.run('rollback;')
  assert.equal(adminSql(`select is_draft from public.assignments where id = '${assignment}';`), 't')
  console.log('Passed: release_clock_sampled_after_lock_wait')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  adminSql(`
    delete from public.classrooms where id = '${classroom}';
    delete from public.effective_feature_entitlement_audit
    where subject_user_id in ('${owner}', '${successor}');
    delete from public.users where id in ('${owner}', '${successor}');
  `)
}
