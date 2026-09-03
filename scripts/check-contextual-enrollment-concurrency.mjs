#!/usr/bin/env node
// Local-only, multi-connection contracts. Creates random synthetic fixtures,
// removes them in finally, and never applies migrations or reads hosted secrets.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const container = 'supabase_db_pika'
assert.equal(
  execFileSync('docker', ['inspect', container, '--format', '{{ index .Config.Labels "com.supabase.cli.project" }}'], { encoding: 'utf8' }).trim(),
  'pika'
)
assert.match(execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }), /:54322\s*$/m)

const tag = `join_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const actor = randomUUID()
const owner = randomUUID()
const classes = Array.from({ length: 5 }, () => randomUUID())
const sessions = []
const rateLimitHashes = new Set()

class Session {
  constructor(name) {
    this.name = `${tag}_${name}`
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
      WHERE waiting.application_name = '${waiter.name}'
        AND holding.application_name = '${blocker.name}'
        AND waiting.wait_event_type = 'Lock'
        AND holding.pid = ANY(pg_blocking_pids(waiting.pid))
    );`)
    if (result === 't') return
    await delay(50)
  }
  throw new Error(`Expected ${waiter.name} to block on ${blocker.name}`)
}

const hash = (label) => {
  const value = createHash('sha256').update(`${tag}:${label}`, 'utf8').digest('hex')
  rateLimitHashes.add(value)
  return value
}
const joinSql = (classroomId, code, actorHash, invitationHash) =>
  `SET ROLE service_role; SELECT public.join_classroom_by_code_atomic_v1(
    '${actor}', '${classroomId}', '${code}', '${actorHash}', '${invitationHash}',
    'Concurrent', 'Actor', NULL, NULL
  )::text;`

let fixturesCreated = false
try {
  await admin.run("SET statement_timeout = '15s'; SET lock_timeout = '12s';")
  assert.equal(
    await admin.run("SELECT to_regprocedure('public.join_classroom_by_code_atomic_v1(uuid,uuid,text,text,text,text,text,text,jsonb)') IS NOT NULL;"),
    't',
    'Migration 155 must already be applied; this harness never applies it'
  )
  await admin.run(`BEGIN;
    INSERT INTO public.users (id, email, role) VALUES
      ('${actor}', '${tag}_actor@example.invalid', 'teacher'),
      ('${owner}', '${tag}_owner@example.invalid', 'teacher');
    INSERT INTO public.classrooms (
      id, teacher_id, title, class_code, allow_enrollment, join_policy
    ) VALUES
      ('${classes[0]}', '${owner}', '${tag}', '${tag}_duplicate', true, 'open_join'),
      ('${classes[1]}', '${owner}', '${tag}', '${tag}_archive', true, 'open_join'),
      ('${classes[2]}', '${owner}', '${tag}', '${tag}_closed', true, 'open_join'),
      ('${classes[3]}', '${owner}', '${tag}', '${tag}_owner', true, 'open_join'),
      ('${classes[4]}', '${owner}', '${tag}', '${tag}_write_first', true, 'open_join');
    COMMIT;`)
  fixturesCreated = true

  const duplicateHolder = await newSession('duplicate_holder')
  const duplicateWaiter = await newSession('duplicate_waiter')
  const first = JSON.parse(await duplicateHolder.run(`BEGIN; ${joinSql(classes[0], `${tag}_duplicate`, hash('a'), hash('b'))}`))
  const secondPromise = duplicateWaiter.run(joinSql(classes[0], `${tag}_duplicate`, hash('a'), hash('b')))
  await waitBlocked(duplicateWaiter, duplicateHolder)
  await duplicateHolder.run('COMMIT;')
  const second = JSON.parse(await secondPromise)
  assert.equal(first.created, true)
  assert.equal(second.created, false)
  assert.equal(await admin.run(`SELECT count(*) FROM public.classroom_enrollments WHERE classroom_id = '${classes[0]}';`), '1')
  assert.equal(await admin.run(`SELECT count(*) FROM public.classroom_roster WHERE classroom_id = '${classes[0]}';`), '1')
  assert.equal(await admin.run(`SELECT count(*) FROM public.classroom_roster_student_bindings WHERE classroom_id = '${classes[0]}';`), '1')
  console.log('Passed: duplicate joins serialize to one complete membership')

  for (const [label, mutation, classroomId, code, expected, invitationHashCharacter] of [
    ['archive_wins', `UPDATE public.classrooms SET archived_at = clock_timestamp() WHERE id = '${classes[1]}';`, classes[1], `${tag}_archive`, 'classroom_not_found', '1'],
    ['enrollment_close_wins', `UPDATE public.classrooms SET allow_enrollment = false WHERE id = '${classes[2]}';`, classes[2], `${tag}_closed`, 'enrollment_closed', '2'],
    ['ownership_change_wins', `UPDATE public.classrooms SET teacher_id = '${actor}' WHERE id = '${classes[3]}';`, classes[3], `${tag}_owner`, 'owner_self_join', '3'],
  ]) {
    const holder = await newSession(`${label}_holder`)
    const waiter = await newSession(`${label}_waiter`)
    await holder.run(`BEGIN; ${mutation}`)
    const outcome = waiter.run(joinSql(classroomId, code, hash('c'), hash(invitationHashCharacter)))
    await waitBlocked(waiter, holder)
    await holder.run('COMMIT;')
    assert.equal(JSON.parse(await outcome).error_code, expected)
    assert.equal(await admin.run(`SELECT count(*) FROM public.classroom_enrollments WHERE classroom_id = '${classroomId}';`), '0')
    console.log(`Passed: ${label}`)
  }

  const joinHolder = await newSession('join_first_holder')
  const archiveWaiter = await newSession('join_first_waiter')
  const joinResult = JSON.parse(await joinHolder.run(`BEGIN; ${joinSql(classes[4], `${tag}_write_first`, hash('d'), hash('e'))}`))
  assert.equal(joinResult.created, true)
  const archivePromise = archiveWaiter.run(`UPDATE public.classrooms SET archived_at = clock_timestamp() WHERE id = '${classes[4]}';`)
  await waitBlocked(archiveWaiter, joinHolder)
  await joinHolder.run('COMMIT;')
  await archivePromise
  assert.equal(await admin.run(`SELECT count(*) FROM public.classroom_enrollments WHERE classroom_id = '${classes[4]}';`), '1')
  console.log('Passed: committed join linearizes before a later archive')

  const limiterSessions = await Promise.all(Array.from({ length: 4 }, (_, index) => newSession(`limiter_${index}`)))
  const limiterResults = await Promise.all(limiterSessions.map((session) => session.run(joinSql(
    randomUUID(),
    `${tag}_missing`,
    hash('f'),
    hash('0')
  ))))
  const parsedLimiterResults = limiterResults.map((result) => JSON.parse(result))
  assert.equal(parsedLimiterResults.filter((result) => result.error_code === 'classroom_not_found').length, 3)
  assert.equal(parsedLimiterResults.filter((result) => result.error_code === 'rate_limited').length, 1)
  console.log('Passed: concurrent invitation guesses admit exactly the fixed budget')

  console.log('All contextual enrollment concurrency contracts passed.')
} finally {
  try {
    const workers = sessions.filter((session) => session !== admin)
    if (workers.length) {
      await admin.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name IN (${workers.map((session) => `'${session.name}'`).join(',')});`)
    }
    await Promise.all(workers.map((session) => session.close()))
    if (fixturesCreated) {
      const rateLimitCleanup = rateLimitHashes.size
        ? `DELETE FROM public.classroom_join_rate_limits WHERE key_hash IN (${[...rateLimitHashes].map((value) => `'${value}'`).join(',')});`
        : ''
      await admin.run(`BEGIN;
        DELETE FROM public.classrooms WHERE id IN (${classes.map((id) => `'${id}'`).join(',')}) AND title = '${tag}';
        ${rateLimitCleanup}
        DELETE FROM public.users WHERE
          (id = '${actor}' AND email = '${tag}_actor@example.invalid') OR
          (id = '${owner}' AND email = '${tag}_owner@example.invalid');
        COMMIT;`)
      assert.equal(
        await admin.run(`SELECT (SELECT count(*) FROM public.classrooms WHERE id IN (${classes.map((id) => `'${id}'`).join(',')})) + (SELECT count(*) FROM public.users WHERE id IN ('${actor}', '${owner}'));`),
        '0',
        'Synthetic fixture cleanup must be complete'
      )
      console.log('Removed this run’s synthetic fixtures; no real classroom data was changed.')
    }
  } finally {
    await admin.close()
  }
}
