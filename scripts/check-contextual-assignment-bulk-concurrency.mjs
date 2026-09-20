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

const tag = `assignment_bulk_${randomUUID().replaceAll('-', '').slice(0, 8)}`
const owner = randomUUID()
const otherOwner = randomUUID()
const classroom = randomUUID()
const otherClassroom = randomUUID()
const assignmentOne = randomUUID()
const assignmentTwo = randomUUID()
const otherAssignment = randomUUID()
const sessions = []

function adminSql(sql) {
  return execFileSync('docker', [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres',
    '-X', '-qAt', '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, encoding: 'utf8' }).trim()
}

class Session {
  constructor(name) {
    this.name = `ab_${tag.slice(-8)}_${name}`
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

function item(id, title) {
  return JSON.stringify({
    id,
    title,
    due_at: '2099-09-30T20:00:00Z',
    instructions_markdown: '',
    description: '',
    rich_instructions: { type: 'doc', content: [] },
    is_draft: true,
  })
}

function bulkSql(items) {
  return `set role service_role;
    select result->>'ok' from (select public.save_assignments_bulk_for_owner_v1(
      '${owner}', '${classroom}', '${items}'::jsonb
    ) as result) as saved;
    reset role;`
}

try {
  assert.equal(adminSql(`select exists (
    select 1 from supabase_migrations.schema_migrations where version = '199'
  );`), 't', 'Migration 199 must already be applied')

  adminSql(`
    insert into public.users (id, email, role) values
      ('${owner}', '${tag}-owner@example.invalid', 'student'),
      ('${otherOwner}', '${tag}-other-owner@example.invalid', 'teacher');
    set role service_role;
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${owner}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 2, 'test:migration-198', '${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = '${owner}' and feature_key = 'classrooms.create'), 0)
    );
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${otherOwner}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 2, 'test:migration-199', '${tag}-other',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = '${otherOwner}' and feature_key = 'classrooms.create'), 0)
    );
    reset role;
    insert into public.classrooms (id, teacher_id, title, class_code) values
      ('${classroom}', '${owner}', '${tag}', upper(substr(replace('${classroom}', '-', ''), 1, 8))),
      ('${otherClassroom}', '${otherOwner}', '${tag}-other', upper(substr(replace('${otherClassroom}', '-', ''), 1, 8)));
    insert into public.assignments (id, classroom_id, title, description, due_at, created_by, position) values
      ('${assignmentOne}', '${classroom}', 'First', '', clock_timestamp() + interval '7 days', '${owner}', 0),
      ('${assignmentTwo}', '${classroom}', 'Second', '', clock_timestamp() + interval '7 days', '${owner}', 1),
      ('${otherAssignment}', '${otherClassroom}', 'Other tenant', '', clock_timestamp() + interval '7 days', '${otherOwner}', 0);
  `)

  const classroomFence = new Session('classroom_a_fence')
  const foreignBulk = new Session('foreign_bulk')
  const otherProbe = new Session('classroom_b_probe')
  await classroomFence.run(`begin; select pg_advisory_xact_lock(
    hashtextextended('pika-classroom-operation:${classroom}', 0)
  );`)
  const foreignResult = await Promise.race([
    foreignBulk.run(`begin; ${bulkSql(`[${item(otherAssignment, 'Must stay foreign')}]`)}`),
    delay(2_000).then(() => { throw new Error('Foreign-ID preflight waited on Classroom A') }),
  ])
  assert.equal(foreignResult, 'false')
  assert.equal(await otherProbe.run(`begin;
    do $probe$ begin
      if not pg_try_advisory_xact_lock(
        hashtextextended('assignment_submission:${otherAssignment}', 0)
      ) then
        raise exception 'Foreign bulk held the other Assignment advisory lock';
      end if;
      perform 1 from public.assignments where id = '${otherAssignment}' for update;
    end $probe$;
    select 'free';`), 'free')
  await otherProbe.run('commit;')
  await foreignBulk.run('rollback;')
  await classroomFence.run('rollback;')
  assert.equal(adminSql(`select title from public.assignments where id = '${otherAssignment}';`), 'Other tenant')
  console.log('Passed: foreign_assignment_preflight_takes_no_cross_tenant_locks')

  const archive = new Session('archive_first')
  const deniedBulk = new Session('bulk_second')
  await archive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}';`)
  const denied = deniedBulk.run(`begin; set role service_role;
    do $block$ begin
      perform public.save_assignments_bulk_for_owner_v1(
        '${owner}', '${classroom}', '[${item(assignmentOne, 'Denied')}]'::jsonb
      );
      raise exception 'Expected archived bulk denial';
    exception when sqlstate '55000' then
      if sqlerrm <> 'assignment_bulk_archived' then raise; end if;
    end $block$;
    reset role; select 'denied';`)
  await waitBlocked(deniedBulk, archive)
  await archive.run('commit;')
  assert.equal(await denied, 'denied')
  await deniedBulk.run('rollback;')
  assert.equal(adminSql(`select title from public.assignments where id = '${assignmentOne}';`), 'First')
  console.log('Passed: archive_wins_contextual_assignment_bulk')

  adminSql(`update public.classrooms set archived_at = null where id = '${classroom}';`)

  const bulk = new Session('bulk_first')
  const laterArchive = new Session('archive_second')
  assert.equal(await bulk.run(`begin; ${bulkSql(`[${item(assignmentOne, 'Bulk committed')}]`)}`), 'true')
  const archived = laterArchive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}'; select 'archived';`)
  await waitBlocked(laterArchive, bulk)
  await bulk.run('commit;')
  assert.equal(await archived, 'archived')
  await laterArchive.run('commit;')
  assert.equal(adminSql(`select title from public.assignments where id = '${assignmentOne}';`), 'Bulk committed')
  console.log('Passed: contextual_assignment_bulk_wins_archive')

  adminSql(`update public.classrooms set archived_at = null where id = '${classroom}';`)

  const firstBulk = new Session('overlap_first')
  const secondBulk = new Session('overlap_second')
  assert.equal(await firstBulk.run(`begin; ${bulkSql(`[${item(assignmentTwo, 'First writer two')},${item(assignmentOne, 'First writer one')}]`)}`), 'true')
  const second = secondBulk.run(`begin; ${bulkSql(`[${item(assignmentOne, 'Second writer one')},${item(assignmentTwo, 'Second writer two')}]`)}`)
  await waitBlocked(secondBulk, firstBulk)
  await firstBulk.run('commit;')
  assert.equal(await second, 'true')
  await secondBulk.run('commit;')
  assert.equal(adminSql(`select string_agg(title, ',' order by id) from public.assignments
    where id in ('${assignmentOne}', '${assignmentTwo}');`), [assignmentOne, assignmentTwo]
      .sort()
      .map((id) => id === assignmentOne ? 'Second writer one' : 'Second writer two')
      .join(','))
  console.log('Passed: overlapping_contextual_assignment_bulk_serializes')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  adminSql(`
    delete from public.classrooms where id in ('${classroom}', '${otherClassroom}');
    delete from public.effective_feature_entitlement_audit
      where subject_user_id in ('${owner}', '${otherOwner}');
    delete from public.users where id in ('${owner}', '${otherOwner}');
  `)
}
