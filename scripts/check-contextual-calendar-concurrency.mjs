#!/usr/bin/env node
// Local-only, multi-connection contracts. Creates only random synthetic fixtures,
// removes them in finally, and never applies migrations or reads hosted credentials.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
const tag = `calendar_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const actor = randomUUID()
const other = randomUUID()
const classes = Array.from({ length: 5 }, () => randomUUID())
const grantOperation = randomUUID()
const people = [[actor, `${tag}_owner@example.invalid`], [other, `${tag}_other@example.invalid`]]
const sessions = []
const q = (value) => `'${value.replaceAll("'", "''")}'`
const ids = (values) => values.map(q).join(',')
const peopleValues = people.map(([id, email]) => `(${q(id)}::uuid,${q(email)})`).join(',')
const tables = ['users', 'classrooms', 'class_days', 'classroom_enrollments', 'classroom_archive_revisions',
  'account_plans', 'account_plan_audit', 'effective_feature_entitlements', 'effective_feature_entitlement_audit']
function command(binary, args, input) {
  try {
    return execFileSync(binary, args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 35_000, maxBuffer: 5_000_000 }).trim()
  } catch {
    throw new Error('Local calendar concurrency command failed; captured output withheld')
  }
}
function sql(statement) {
  return command('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
    `SET statement_timeout = '25s'; SET lock_timeout = '5s'; ${statement}`)
}
const baseline = () => JSON.parse(sql(`SELECT jsonb_build_object(${tables.map(table => `${q(table)},(SELECT count(*) FROM public.${table})`).join(',')});`))

class Session {
  constructor(name) {
    this.name = `${tag}_${name}`
    this.output = ''
    this.errors = ''
    this.pending = null
    this.closed = false
    this.child = spawn('docker', ['exec', '-i', '-e', `PGAPPNAME=${this.name}`, container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'])
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
      const error = new Error(`Synthetic SQL session exited (${code}); captured output withheld`)
      error.sqlstate = this.errors.match(/ERROR: +([A-Z0-9]{5}):/)?.[1]
      this.fail(error)
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
    let timer
    try {
      await Promise.race([this.done, new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          // Exact random application name, never a project-wide session target.
          try { sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = ${q(this.name)};`) }
          catch { reject(new Error('Exact synthetic session termination failed; captured output withheld')) }
          finally { this.child.kill('SIGTERM'); resolve() }
        }, 5_000)
      })])
      if (!this.closed) {
        await Promise.race([this.done, delay(2_000)])
        assert(this.closed, 'Synthetic SQL session must close before cleanup')
      }
    } finally { clearTimeout(timer) }
  }
}

let admin
async function newSession(name) {
  const session = new Session(name)
  await session.run("SET statement_timeout = '15s'; SET lock_timeout = '12s';")
  return session
}
async function waitBlocked(waiter, blocker) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const result = await admin.run(`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity waiting, pg_stat_activity holding
      WHERE waiting.application_name = '${waiter.name}' AND holding.application_name = '${blocker.name}'
        AND waiting.wait_event_type = 'Lock' AND holding.pid = ANY(pg_blocking_pids(waiting.pid))
    );`)
    if (result === 't') return
    if (waiter.closed) throw new Error('Contender exited before blocking; captured output withheld')
    await delay(50)
  }
  throw new Error('Expected contender to block on the coordinator; no timing-only race assertions')
}
async function race(label, first, second, expectedCode) {
  const holder = await newSession(`${label}_holder`)
  const waiter = await newSession(`${label}_waiter`)
  await holder.run(`BEGIN; ${first}`)
  // Attach both handlers immediately, including for expected ON_ERROR_STOP exits.
  const outcome = waiter.run(second).then((value) => ({ value }), (error) => ({ error }))
  await waitBlocked(waiter, holder)
  await holder.run('COMMIT;')
  const result = await outcome
  if (expectedCode) assert.equal(result.error?.sqlstate, expectedCode)
  else if (result.error) throw result.error
  await holder.close()
  await waiter.close()
  console.log(`Passed: ${label}`)
}

async function main() {
  assert.equal(command('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}']), 'pika')
  assert.match(command('docker', ['port', container, '5432/tcp']), /:54322\s*$/m)
  const initialBaseline = baseline()
  admin = new Session('observer')
  try {
  await admin.run("SET statement_timeout = '15s'; SET lock_timeout = '12s';")
  assert.equal(await admin.run("SELECT to_regprocedure('public.create_classroom_calendar_v1(uuid,uuid,date,date,date[])') IS NOT NULL AND to_regprocedure('public.set_classroom_calendar_day_v1(uuid,uuid,date,boolean)') IS NOT NULL;"), 't', 'Migration 152 must already be applied')
  await admin.run(`BEGIN;
    INSERT INTO public.users (id, email, role) VALUES
      ('${actor}', '${tag}_owner@example.invalid', 'student'), ('${other}', '${tag}_other@example.invalid', 'teacher');
    SET LOCAL ROLE service_role;
    SELECT public.set_effective_feature_entitlement_v1('${grantOperation}', '${actor}',
      'classrooms.create', 'manual', true, clock_timestamp(), null, 5,
      'test:calendar-concurrency', '${tag}',
      coalesce((SELECT revision FROM public.effective_feature_entitlements
        WHERE subject_user_id = '${actor}' AND feature_key = 'classrooms.create'), 0));
    RESET ROLE;
    INSERT INTO public.classrooms (id, teacher_id, title, class_code) VALUES
      ${classes.map((id, index) => `('${id}', '${actor}', '${tag}', '${tag}_${index}')`).join(',')};
    COMMIT;`)
  if (process.argv.includes('--verify-cleanup-after-fixture')) throw new Error('Forced calendar concurrency post-fixture cleanup proof')
  const date = await admin.run("SELECT ((clock_timestamp() AT TIME ZONE 'America/Toronto')::date + 10)::text;")
  const toggle = (id, value) => `SET ROLE service_role; SELECT count(*) FROM public.set_classroom_calendar_day_v1('${actor}', '${id}', '${date}', ${value});`
  const create = (id) => `SET ROLE service_role; SELECT count(*) FROM public.create_classroom_calendar_v1('${actor}', '${id}', '${date}', '${date}'::date + 2, ARRAY['${date}'::date, '${date}'::date + 1]);`

  await race('archive_wins', `UPDATE public.classrooms SET archived_at = clock_timestamp() WHERE id = '${classes[0]}';`, toggle(classes[0], true), '42501')
  await race('owner_change_wins', `UPDATE public.classrooms SET teacher_id = '${other}' WHERE id = '${classes[1]}';`, create(classes[1]), '42501')
  assert.equal(await admin.run(`SELECT count(*) FROM public.class_days WHERE classroom_id IN ('${classes[0]}', '${classes[1]}');`), '0')

  await race('calendar_write_wins', toggle(classes[2], false), `UPDATE public.classrooms SET archived_at = clock_timestamp() WHERE id = '${classes[2]}';`)
  assert.equal(await admin.run(`SELECT count(*) FROM public.class_days d JOIN public.classrooms c ON c.id = d.classroom_id WHERE c.id = '${classes[2]}' AND c.archived_at IS NOT NULL AND NOT d.is_class_day;`), '1')

  await race('duplicate_calendar', create(classes[3]), create(classes[3]), '23505')
  assert.equal(await admin.run(`SELECT count(*) FROM public.class_days WHERE classroom_id = '${classes[3]}';`), '2')
  assert.equal(await admin.run(`SELECT start_date = '${date}'::date AND end_date = '${date}'::date + 2 FROM public.classrooms WHERE id = '${classes[3]}';`), 't')

  await admin.run(`INSERT INTO public.class_days (classroom_id, date, is_class_day, prompt_text) VALUES ('${classes[4]}', '${date}', true, 'Keep this prompt');`)
  await race('competing_toggles', toggle(classes[4], false), toggle(classes[4], true))
  assert.equal(await admin.run(`SELECT count(*) FROM public.class_days WHERE classroom_id = '${classes[4]}' AND date = '${date}' AND is_class_day AND prompt_text = 'Keep this prompt';`), '1')
  console.log('All contextual calendar concurrency contracts passed.')
  } finally {
  // Terminate only this invocation's precisely named sessions, releasing held locks
  // before fixture deletion. Never kill another test invocation or user session.
  // Use a fresh bounded command: the observer may already have exited on a
  // fixture setup failure. Termination targets only exact names from this run.
  try {
    sql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name IN (${ids(sessions.map(session => session.name))});`)
  } catch {
    // Graceful per-session close remains available if termination failed.
  }
  const closed = await Promise.allSettled(sessions.map(session => session.close()))
  assert(closed.every(result => result.status === 'fulfilled'), 'All synthetic SQL sessions must close')
  assert.equal(sql(`SELECT count(*) FROM pg_stat_activity WHERE application_name IN (${ids(sessions.map(session => session.name))});`), '0',
    'No SQL sessions from this run may remain before cleanup')
  // Every retained child SQL session is closed before cleanup starts. This also
  // cleans safely after fixture setup fails and its transaction is rolled back.
  sql(`BEGIN;
    CREATE TEMP TABLE calendar_concurrency_provision_ops(operation_id uuid,subject_user_id uuid,
      PRIMARY KEY(operation_id,subject_user_id)) ON COMMIT DROP;
    INSERT INTO calendar_concurrency_provision_ops
      SELECT DISTINCT a.operation_id,a.subject_user_id FROM public.account_plan_audit a
      JOIN (VALUES ${peopleValues}) identity(id,email) ON identity.id=a.subject_user_id
      JOIN public.users u ON u.id=identity.id AND u.email=identity.email
      WHERE a.actor_ref='system:user-provisioning' AND a.reason_code='default_free_account_provisioning';
    DELETE FROM public.effective_feature_entitlement_audit
      WHERE operation_id=${q(grantOperation)} AND subject_user_id=${q(actor)}
        AND actor_ref='test:calendar-concurrency' AND reason_code=${q(tag)};
    DELETE FROM public.effective_feature_entitlement_audit a USING calendar_concurrency_provision_ops operation
      WHERE a.operation_id=operation.operation_id AND a.subject_user_id=operation.subject_user_id
        AND a.actor_ref='system:user-provisioning' AND a.reason_code='default_free_account_provisioning';
    DELETE FROM public.account_plan_audit a USING calendar_concurrency_provision_ops operation
      WHERE a.operation_id=operation.operation_id AND a.subject_user_id=operation.subject_user_id
        AND a.actor_ref='system:user-provisioning' AND a.reason_code='default_free_account_provisioning';
    DELETE FROM public.classrooms c USING (VALUES ${classes.map((id,index) => `(${q(id)}::uuid,${q(`${tag}_${index}`)})`).join(',')}) fixture(id,class_code)
      WHERE c.id=fixture.id AND c.class_code=fixture.class_code AND c.title=${q(tag)}
        AND c.teacher_id IN (${ids([actor,other])});
    DELETE FROM public.users u USING (VALUES ${peopleValues}) identity(id,email)
      WHERE u.id=identity.id AND u.email=identity.email;
    COMMIT;`)
  assert.equal(sql(`SELECT (SELECT count(*) FROM public.users WHERE id IN (${ids([actor,other])}))+
    (SELECT count(*) FROM public.classrooms WHERE id IN (${ids(classes)}))+
    ${tables.filter(table => !['users','classrooms'].includes(table)).map(table => {
      const key = ['account_plans','account_plan_audit','effective_feature_entitlements','effective_feature_entitlement_audit'].includes(table) ? 'subject_user_id' : 'classroom_id'
      return `(SELECT count(*) FROM public.${table} WHERE ${key} IN (${ids(key === 'subject_user_id' ? [actor,other] : classes)}))`
    }).join('+')};`), '0', 'Exact synthetic fixture residuals must be zero')
  assert.deepEqual(baseline(),initialBaseline)
  console.log('PASS exact synthetic calendar concurrency cleanup, zero residual rows and global baseline counts')
  }
}
main().catch(error => {
  console.error(error instanceof Error && error.message === 'Forced calendar concurrency post-fixture cleanup proof'
    ? 'FAIL Forced calendar concurrency post-fixture cleanup proof (expected for --verify-cleanup-after-fixture)'
    : 'FAIL local calendar concurrency proof; captured command and SQL output withheld')
  process.exitCode = 1
})
