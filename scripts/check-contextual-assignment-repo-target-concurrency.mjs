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

const tag = `repo_target_${randomUUID().replaceAll('-', '').slice(0, 8)}`
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
    this.name = `repo_target_${tag.slice(-8)}_${name}`
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

function targetSql(repoName) {
  return `set role service_role;
    select result#>>'{repo_target,repo_name}'
    from (select public.save_assignment_repo_target_for_owner_v1(
      '${owner}', '${assignment}', '${learner}',
      jsonb_build_object(
        'selected_repo_url', 'https://github.com/codepetca/${repoName}',
        'override_github_username', 'learner-login',
        'repo_owner', 'codepetca',
        'repo_name', '${repoName}',
        'selection_mode', 'teacher_override',
        'validation_status', 'valid',
        'validation_message', null
      ), clock_timestamp()
    ) as result) as saved;
    reset role;`
}

try {
  assert.equal(adminSql(`select exists (
    select 1 from supabase_migrations.schema_migrations where version = '200'
  );`), 't', 'Migration 200 must already be applied')

  adminSql(`
    insert into public.users (id, email, role) values
      ('${owner}', '${tag}-owner@example.invalid', 'student'),
      ('${learner}', '${tag}-learner@example.invalid', 'student');
    set role service_role;
    select public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${owner}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 2, 'test:migration-200', '${tag}',
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
      '${assignment}', '${classroom}', 'Repo target race', '', clock_timestamp() + interval '7 days',
      '${owner}', false, clock_timestamp()
    );
  `)

  const purgeSubject = new Session('purge_subject_wins')
  const retryTarget = new Session('target_retries')
  await purgeSubject.run(`begin; select pg_advisory_xact_lock(
    hashtextextended('pika-student-purge-subject:${learner}', 0)
  );`)
  const retry = await retryTarget.run(`begin; set role service_role;
    do $block$ begin
      perform public.save_assignment_repo_target_for_owner_v1(
        '${owner}', '${assignment}', '${learner}', null, clock_timestamp()
      );
      raise exception 'Expected purge-overlap retry';
    exception when serialization_failure then null;
    end $block$;
    reset role; select 'retry';`)
  assert.equal(retry, 'retry')
  await retryTarget.run('rollback;')
  assert.equal(await purgeSubject.run(`select public.student_purge_lock('${classroom}', '${learner}');
    select 'purge-locked';`), 'purge-locked')
  await purgeSubject.run('commit;')
  assert.equal(adminSql(`select count(*) from public.assignment_repo_targets
    where assignment_id = '${assignment}';`), '0')
  console.log('Passed: student_purge_subject_wins_contextual_assignment_repo_target')

  const archive = new Session('archive_wins')
  const deniedTarget = new Session('target_loses')
  await archive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}';`)
  const denied = deniedTarget.run(`begin; set role service_role;
    do $block$ begin
      perform public.save_assignment_repo_target_for_owner_v1(
        '${owner}', '${assignment}', '${learner}', null, clock_timestamp()
      );
      raise exception 'Expected archived repo-target denial';
    exception when sqlstate '55000' then null;
    end $block$;
    reset role; select 'denied';`)
  await waitBlocked(deniedTarget, archive)
  await archive.run('commit;')
  assert.equal(await denied, 'denied')
  await deniedTarget.run('rollback;')
  console.log('Passed: archive_wins_contextual_assignment_repo_target')

  adminSql(`update public.classrooms set archived_at = null where id = '${classroom}';`)

  const target = new Session('target_wins')
  const laterArchive = new Session('archive_loses')
  assert.equal(await target.run(`begin; ${targetSql('pika')}`), 'pika')
  const archived = laterArchive.run(`begin; update public.classrooms set archived_at = clock_timestamp()
    where id = '${classroom}'; select 'archived';`)
  await waitBlocked(laterArchive, target)
  await target.run('commit;')
  assert.equal(await archived, 'archived')
  await laterArchive.run('commit;')
  assert.equal(adminSql(`select repo_name from public.assignment_repo_targets
    where assignment_id = '${assignment}' and student_id = '${learner}';`), 'pika')
  console.log('Passed: contextual_assignment_repo_target_wins_archive')
} finally {
  await Promise.allSettled(sessions.map((session) => session.close()))
  adminSql(`
    delete from public.classrooms where id = '${classroom}';
    delete from public.effective_feature_entitlement_audit where subject_user_id = '${owner}';
    delete from public.users where id in ('${owner}', '${learner}');
  `)
}
