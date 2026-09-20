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

const tag = `feedback_return_${randomUUID().replaceAll('-', '').slice(0, 8)}`
const owner = randomUUID()
const learner = randomUUID()
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
    this.name = `feedback_${tag.slice(-8)}_${name}`
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

function feedbackReturnSql(body) {
  return `set role service_role;
    select result->>'applied'
    from (select public.return_assignment_feedback_for_owner_v1(
      '${owner}', '${assignment}', '${learner}', '${body}',
      (select updated_at from public.assignment_docs
        where assignment_id = '${assignment}' and student_id = '${learner}'),
      clock_timestamp()
    ) as result) as returned;
    reset role;`
}

try {
  assert.equal(adminSql(`select exists (
    select 1 from supabase_migrations.schema_migrations where version = '196'
  );`), 't', 'Migration 196 must already be applied')

  adminSql(`
    insert into public.users (id, email, role) values
      ('${owner}', '${tag}-owner@example.invalid', 'student'),
      ('${learner}', '${tag}-learner@example.invalid', 'student');
    set role service_role;
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${owner}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 2, 'test:migration-196', '${tag}',
      coalesce((select revision from public.effective_feature_entitlements
        where subject_user_id = '${owner}' and feature_key = 'classrooms.create'), 0)
    );
    reset role;
    insert into public.classrooms (id, teacher_id, title, class_code)
    values ('${classroom}', '${owner}', '${tag}', upper(substr(replace('${classroom}', '-', ''), 1, 8)));
    insert into public.classroom_enrollments (classroom_id, student_id)
    values ('${classroom}', '${learner}');
    insert into public.assignments (
      id, classroom_id, title, description, due_at, created_by, is_draft, released_at
    ) values (
      '${assignment}', '${classroom}', 'Feedback-return race', '', clock_timestamp() + interval '7 days',
      '${owner}', false, clock_timestamp()
    );
    insert into public.assignment_docs (
      assignment_id, student_id, content, is_submitted, submitted_at, teacher_feedback_draft
    ) values (
      '${assignment}', '${learner}', '{"type":"doc","content":[]}'::jsonb,
      true, clock_timestamp(), 'Draft feedback'
    );
  `)

  const purgeSubject = new Session('purge_subject_wins')
  const retryReturn = new Session('return_retries')
  await purgeSubject.run(`begin; select pg_advisory_xact_lock(
    hashtextextended('pika-student-purge-subject:${learner}', 0)
  );`)
  const retry = await retryReturn.run(`begin; set role service_role;
    do $block$ begin
      perform public.return_assignment_feedback_for_owner_v1(
        '${owner}', '${assignment}', '${learner}', 'Retry me',
        (select updated_at from public.assignment_docs
          where assignment_id = '${assignment}' and student_id = '${learner}'),
        clock_timestamp()
      );
      raise exception 'Expected purge-overlap retry';
    exception when serialization_failure then null;
    end $block$;
    reset role; select 'retry';`)
  assert.equal(retry, 'retry')
  await retryReturn.run('rollback;')
  assert.equal(await purgeSubject.run(`select public.student_purge_lock('${classroom}', '${learner}');
    select 'purge-locked';`), 'purge-locked')
  await purgeSubject.run('commit;')
  assert.equal(adminSql(`select feedback_returned_at is null from public.assignment_docs
    where assignment_id = '${assignment}' and student_id = '${learner}';`), 't')
  console.log('Passed: student_purge_subject_wins_contextual_assignment_feedback_return')

  const archive = new Session('archive_wins')
  const deniedReturn = new Session('return_loses')
  await archive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}';`)
  const denied = deniedReturn.run(`begin; set role service_role;
    do $block$ begin
      perform public.return_assignment_docs_for_owner_v1(
        '${owner}', '${assignment}', array['${learner}'::uuid], clock_timestamp()
      );
      raise exception 'Expected archived feedback-return denial';
    exception when sqlstate '55000' then
      if sqlerrm <> 'assignment_feedback_return_archived' then raise; end if;
    end $block$;
    reset role; select 'denied';`)
  await waitBlocked(deniedReturn, archive)
  await archive.run('commit;')
  assert.equal(await denied, 'denied')
  await deniedReturn.run('rollback;')
  assert.equal(adminSql(`select feedback_returned_at is null from public.assignment_docs
    where assignment_id = '${assignment}' and student_id = '${learner}';`), 't')
  console.log('Passed: archive_wins_contextual_assignment_feedback_return')

  adminSql(`update public.classrooms set archived_at = null where id = '${classroom}';`)

  const feedbackReturn = new Session('return_wins')
  const laterArchive = new Session('archive_loses')
  assert.equal(await feedbackReturn.run(`begin; ${feedbackReturnSql('Committed feedback')}`), 'true')
  const archived = laterArchive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}'; select 'archived';`)
  await waitBlocked(laterArchive, feedbackReturn)
  await feedbackReturn.run('commit;')
  assert.equal(await archived, 'archived')
  await laterArchive.run('commit;')
  assert.equal(adminSql(`select feedback = 'Committed feedback' and feedback_returned_at is not null
    from public.assignment_docs
    where assignment_id = '${assignment}' and student_id = '${learner}';`), 't')
  assert.equal(adminSql(`select exists (
    select 1 from public.assignment_feedback_entries
    where assignment_id = '${assignment}' and student_id = '${learner}'
      and created_by = '${owner}' and body = 'Committed feedback'
  );`), 't')
  console.log('Passed: contextual_assignment_feedback_return_wins_archive')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  adminSql(`
    delete from public.classrooms where id = '${classroom}';
    delete from public.effective_feature_entitlement_audit where subject_user_id = '${owner}';
    delete from public.users where id in ('${owner}', '${learner}');
  `)
}
