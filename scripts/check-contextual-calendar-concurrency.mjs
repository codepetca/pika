#!/usr/bin/env node
// Local-only, multi-connection contracts. Creates only random synthetic fixtures,
// removes them in finally, and never applies migrations or reads hosted credentials.
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(), 'pika')
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)
const tag = `calendar_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const actor = randomUUID()
const other = randomUUID()
const classes = Array.from({ length: 5 }, () => randomUUID())
const sessions = []

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

const admin = new Session('observer')
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
    if (waiter.closed) throw new Error(`Contender exited before blocking: ${waiter.errors}`)
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
  if (expectedCode) assert.match(result.error?.message ?? '', new RegExp(`ERROR: +${expectedCode}:`))
  else if (result.error) throw result.error
  await holder.close()
  await waiter.close()
  console.log(`Passed: ${label}`)
}

let fixturesCreated = false
try {
  await admin.run("SET statement_timeout = '15s'; SET lock_timeout = '12s';")
  assert.equal(await admin.run("SELECT to_regprocedure('public.create_classroom_calendar_v1(uuid,uuid,date,date,date[])') IS NOT NULL AND to_regprocedure('public.set_classroom_calendar_day_v1(uuid,uuid,date,boolean)') IS NOT NULL;"), 't', 'Migration 152 must already be applied')
  await admin.run(`BEGIN;
    INSERT INTO public.users (id, email, role) VALUES
      ('${actor}', '${tag}_owner@example.invalid', 'student'), ('${other}', '${tag}_other@example.invalid', 'teacher');
    INSERT INTO public.classrooms (id, teacher_id, title, class_code) VALUES
      ${classes.map((id, index) => `('${id}', '${actor}', '${tag}', '${tag}_${index}')`).join(',')};
    COMMIT;`)
  fixturesCreated = true
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
  try {
    const workers = sessions.filter((session) => session !== admin)
    if (workers.length) await admin.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name IN (${workers.map((session) => `'${session.name}'`).join(',')});`)
    await Promise.all(workers.map((session) => session.close()))
    if (fixturesCreated) {
      await admin.run(`BEGIN;
        DELETE FROM public.classrooms WHERE id IN (${classes.map((id) => `'${id}'`).join(',')}) AND title = '${tag}' AND teacher_id IN ('${actor}', '${other}');
        DELETE FROM public.users WHERE (id = '${actor}' AND email = '${tag}_owner@example.invalid') OR (id = '${other}' AND email = '${tag}_other@example.invalid');
        COMMIT;`)
      assert.equal(await admin.run(`SELECT (SELECT count(*) FROM public.classrooms WHERE id IN (${classes.map((id) => `'${id}'`).join(',')})) + (SELECT count(*) FROM public.users WHERE id IN ('${actor}', '${other}'));`), '0', 'Synthetic fixture cleanup must be complete')
      console.log('Removed this run’s synthetic fixtures; no real classroom data was changed.')
    }
  } finally {
    await admin.close()
  }
}
