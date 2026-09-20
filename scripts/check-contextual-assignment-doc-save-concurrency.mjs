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
assert.match(
  execFileSync('docker', ['port', container, '5432/tcp'], { encoding: 'utf8' }),
  /:54322\s*$/m,
)

const tag = `assignment_save_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const actor = randomUUID()
const owner = randomUUID()
const classrooms = Array.from({ length: 20 }, () => randomUUID())
const assignments = Array.from({ length: 20 }, () => randomUUID())
const saveSessions = Array.from({ length: 20 }, () => randomUUID())
const metricSessions = Array.from({ length: 20 }, () => randomUUID())
const restoreSessions = Array.from({ length: 20 }, () => randomUUID())
const restoreMetricSessions = Array.from({ length: 20 }, () => randomUUID())
const sessions = []

class Session {
  constructor(name) {
    // PostgreSQL truncates application_name at 63 bytes. Keep the random run
    // identifier while leaving enough room for descriptive race labels.
    this.name = `as_${tag.slice(-10)}_${name}`
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
      const timer = setTimeout(
        () => this.fail(new Error(`Session timeout: ${this.name}`)),
        20_000,
      )
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
      SELECT 1 FROM pg_stat_activity AS waiting, pg_stat_activity AS holding
      WHERE waiting.application_name = '${waiter.name}'
        AND holding.application_name = '${blocker.name}'
        AND waiting.wait_event_type = 'Lock'
        AND holding.pid = ANY(pg_blocking_pids(waiting.pid))
    );`)
    if (result === 't') return
    if (!waiter.pending) {
      throw new Error(
        `Contender completed before blocking: ${waiter.output.trim()} ${waiter.errors.trim()}`.trim(),
      )
    }
    if (waiter.closed) throw new Error(`Contender exited before blocking: ${waiter.errors}`)
    await delay(50)
  }
  const diagnostic = await admin.run(`SELECT concat_ws('|',
    state, wait_event_type, wait_event, array_to_string(pg_blocking_pids(pid), ','),
    left(query, 200))
    FROM pg_stat_activity WHERE application_name = '${waiter.name}';`)
  throw new Error(
    `Expected ${waiter.name} to block on ${blocker.name}; waiter=${diagnostic}; `
      + `closed=${waiter.closed}; exit=${waiter.child.exitCode}; output=${waiter.output.trim()}; errors=${waiter.errors.trim()}`,
  )
}

function revisionSql(index) {
  return `(SELECT updated_at FROM public.assignment_docs WHERE assignment_id = '${assignments[index]}' AND student_id = '${actor}')`
}

function saveSql(index, expectedUpdatedAt = 'null', sequence = 1) {
  return `SET ROLE service_role;
    SELECT concat(result->>'ok', '|', result->>'created')
    FROM (SELECT public.save_assignment_doc_for_member_v1(
        '${actor}', '${assignments[index]}',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${tag}"}]}]}'::jsonb,
        ${expectedUpdatedAt}, 'autosave', 0, 1, '[]'::jsonb,
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${tag}"}]}]}'::jsonb,
        1, ${tag.length}, '${saveSessions[index]}', ${sequence}, '${metricSessions[index]}'
      ) AS result
    ) AS saved;
    RESET ROLE;`
}

function legacySaveSql(index, expectedUpdatedAt = revisionSql(index), sequence = 2) {
  return `SET ROLE service_role;
    SELECT concat(result->>'ok', '|', coalesce(result->>'error_code', 'ok'))
    FROM (SELECT public.save_assignment_doc_atomic(
        '${assignments[index]}', '${actor}',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${tag}_${sequence}"}]}]}'::jsonb,
        ${expectedUpdatedAt}, 'restore', 0, 1, '[]'::jsonb, null,
        1, ${tag.length + 2}, '${saveSessions[index]}', ${sequence}, '${metricSessions[index]}'
      ) AS result
    ) AS saved;
    RESET ROLE;`
}

function submitSql(index) {
  return `SET ROLE service_role;
    SELECT concat(result->>'ok', '|', coalesce(result->>'error_code', 'ok'))
    FROM (SELECT public.submit_assignment_doc_atomic(
        '${assignments[index]}', '${actor}',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${tag}"}]}]}'::jsonb,
        ${revisionSql(index)}, 1, ${tag.length}, '{}'::uuid[]
      ) AS result
    ) AS submitted;
    RESET ROLE;`
}

function unsubmitSql(index) {
  return `SET ROLE service_role;
    SELECT concat(result->>'ok', '|', coalesce(result->>'error_code', 'ok'))
    FROM (SELECT public.unsubmit_assignment_doc_atomic(
        '${assignments[index]}', '${actor}'
      ) AS result
    ) AS unsubmitted;
    RESET ROLE;`
}

function contextualSubmitSql(index) {
  return `SET ROLE service_role;
    SELECT concat(result->>'ok', '|', coalesce(result->>'error_code', 'ok'))
    FROM (SELECT public.submit_assignment_doc_for_member_v1(
        '${actor}', '${assignments[index]}',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${tag}"}]}]}'::jsonb,
        ${revisionSql(index)}, 1, ${tag.length}, '{}'::uuid[], false, null
      ) AS result
    ) AS submitted;
    RESET ROLE;`
}

function contextualUnsubmitSql(index) {
  return `SET ROLE service_role;
    SELECT concat(result->>'ok', '|', coalesce(result->>'error_code', 'ok'))
    FROM (SELECT public.unsubmit_assignment_doc_for_member_v1(
        '${actor}', '${assignments[index]}'
      ) AS result
    ) AS unsubmitted;
    RESET ROLE;`
}

function contextualRestoreSql(index) {
  return `SET ROLE service_role;
    SELECT concat(result->>'ok', '|', coalesce(result->>'error_code', 'ok'))
    FROM (SELECT public.restore_assignment_doc_for_member_v1(
        '${actor}', '${assignments[index]}',
        (SELECT history.id FROM public.assignment_doc_history AS history
          JOIN public.assignment_docs AS doc ON doc.id = history.assignment_doc_id
          WHERE doc.assignment_id = '${assignments[index]}' AND doc.student_id = '${actor}'
          ORDER BY history.created_at, history.id LIMIT 1),
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${tag}_restored"}]}]}'::jsonb,
        ${revisionSql(index)}, '[]'::jsonb,
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${tag}_restored"}]}]}'::jsonb,
        1, ${tag.length + 9}, '${restoreSessions[index]}', 1, '${restoreMetricSessions[index]}'
      ) AS result
    ) AS restored;
    RESET ROLE;`
}

async function blockingRace(label, holderSql, waiterSql, expectedCode) {
  const holder = await newSession(`${label}_holder`)
  const waiter = await newSession(`${label}_waiter`)
  await holder.run(`BEGIN; ${holderSql}`)
  const outcome = waiter.run(waiterSql).then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
  await waitBlocked(waiter, holder)
  await holder.run('COMMIT;')
  const result = await outcome
  assert.match(result.error?.message ?? '', new RegExp(`ERROR: +${expectedCode}:`))
  await holder.close()
  await waiter.close()
  console.log(`Passed: ${label}`)
}

let fixturesCreated = false
try {
  await admin.run("SET statement_timeout = '15s'; SET lock_timeout = '12s';")
  assert.equal(
    await admin.run("SELECT to_regprocedure('public.save_assignment_doc_for_member_v1(uuid,uuid,jsonb,timestamp with time zone,text,integer,integer,jsonb,jsonb,integer,integer,uuid,bigint,uuid)') IS NOT NULL;"),
    't',
    'Migration 184 must already be applied',
  )
  assert.equal(
    await admin.run("SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '185');"),
    't',
    'Migration 185 must already be applied',
  )
  assert.equal(
    await admin.run("SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '186');"),
    't',
    'Migration 186 must already be applied',
  )
  assert.equal(
    await admin.run("SELECT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '188');"),
    't',
    'Migration 188 must already be applied',
  )
  await admin.run(`BEGIN;
    INSERT INTO public.users (id, email, role) VALUES
      ('${actor}', '${tag}_actor@example.invalid', 'teacher'),
      ('${owner}', '${tag}_owner@example.invalid', 'student');
    SET LOCAL ROLE service_role;
    SELECT public.set_effective_feature_entitlement_v1(
      gen_random_uuid(), '${owner}', 'classrooms.create', 'manual', true,
      clock_timestamp(), null, 20, 'test:migration-184', 'assignment_save_concurrency_fixture',
      coalesce((SELECT revision FROM public.effective_feature_entitlements
        WHERE subject_user_id = '${owner}' AND feature_key = 'classrooms.create'), 0)
    );
    RESET ROLE;
    INSERT INTO public.classrooms (id, teacher_id, title, class_code) VALUES
      ${classrooms.map((id, index) => `('${id}', '${owner}', '${tag}', '${tag}_${index}')`).join(',')};
    INSERT INTO public.classroom_enrollments (classroom_id, student_id)
      SELECT requested.classroom_id, '${actor}'::uuid FROM unnest(ARRAY[
        ${classrooms.map((id) => `'${id}'::uuid`).join(',')}
      ]) AS requested(classroom_id);
    INSERT INTO public.assignments (
      id, classroom_id, title, description, due_at, created_by, is_draft, released_at
    ) VALUES
      ${assignments.map((id, index) => `('${id}', '${classrooms[index]}', '${tag}', '', clock_timestamp() + interval '7 days', '${owner}', false, clock_timestamp() - interval '1 hour')`).join(',')};
    COMMIT;`)
  fixturesCreated = true

  // Removal commits first: the waiting save rechecks enrollment and writes nothing.
  await blockingRace(
    'removal_wins',
    `DELETE FROM public.classroom_enrollments WHERE classroom_id = '${classrooms[0]}' AND student_id = '${actor}';`,
    saveSql(0),
    '42501',
  )
  assert.equal(
    await admin.run(`SELECT count(*) FROM public.assignment_docs WHERE assignment_id = '${assignments[0]}';`),
    '0',
  )

  // Archive and publication changes are re-read after their row locks commit.
  await blockingRace(
    'archive_wins',
    `UPDATE public.classrooms SET archived_at = clock_timestamp() WHERE id = '${classrooms[1]}';`,
    saveSql(1),
    'P0002',
  )
  await blockingRace(
    'draft_wins',
    `UPDATE public.assignments SET is_draft = true, released_at = null WHERE id = '${assignments[2]}';`,
    saveSql(2),
    'P0002',
  )

  // If the save holds the membership fences first, a concurrent raw removal
  // waits for that authorized write and can revoke access only afterward.
  {
    const holder = await newSession('save_wins_holder')
    const remover = await newSession('save_wins_remover')
    assert.equal(await holder.run(`BEGIN; ${saveSql(3)}`), 'true|true')
    const removal = remover.run(
      `DELETE FROM public.classroom_enrollments WHERE classroom_id = '${classrooms[3]}' AND student_id = '${actor}';`,
    ).then((value) => ({ value }), (error) => ({ error }))
    await waitBlocked(remover, holder)
    await holder.run('COMMIT;')
    const removalResult = await removal
    if (removalResult.error) throw removalResult.error
    await holder.close()
    await remover.close()
    assert.equal(await admin.run(`SELECT NOT EXISTS (
      SELECT 1 FROM public.classroom_enrollments
      WHERE classroom_id = '${classrooms[3]}' AND student_id = '${actor}'
    ) AND EXISTS (
      SELECT 1 FROM public.assignment_docs
      WHERE assignment_id = '${assignments[3]}' AND student_id = '${actor}'
    );`), 't')
    console.log('Passed: save_wins')
  }

  // Simultaneous retries queue and converge on one document and one operation.
  {
    const holder = await newSession('duplicate_save_holder')
    const waiter = await newSession('duplicate_save_waiter')
    assert.equal(await holder.run(`BEGIN; ${saveSql(4)}`), 'true|true')
    const outcome = waiter.run(saveSql(4)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(waiter, holder)
    await holder.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.equal(result.value, 'true|false')
    await holder.close()
    await waiter.close()
    assert.equal(
      await admin.run(`SELECT count(*) FROM public.assignment_docs WHERE assignment_id = '${assignments[4]}' AND student_id = '${actor}';`),
      '1',
    )
    assert.equal(
      await admin.run(`SELECT count(*) FROM public.assignment_doc_save_operations AS operation JOIN public.assignment_docs AS doc ON doc.id = operation.assignment_doc_id WHERE doc.assignment_id = '${assignments[4]}' AND doc.student_id = '${actor}';`),
      '1',
    )
    console.log('Passed: duplicate_save')
  }

  // Seed existing documents for the cross-operation lock-order cases.
  for (const index of [5, 6, 7, 8, 9]) {
    assert.equal(await admin.run(saveSql(index)), 'true|true')
  }

  // An existing submit owns its established fence first; contextual save waits
  // without holding a classroom/member fence and then observes immutability.
  {
    const submitter = await newSession('submit_wins_holder')
    const saver = await newSession('submit_wins_waiter')
    assert.equal(await submitter.run(`BEGIN; ${submitSql(5)}`), 'true|ok')
    const outcome = saver.run(saveSql(5, revisionSql(5), 2)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(saver, submitter)
    await submitter.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.equal(result.value, 'false|')
    await submitter.close()
    await saver.close()
    console.log('Passed: submit_wins')
  }

  // Contextual save owns both document fences first; submit waits and returns
  // the established revision conflict after the save commits.
  {
    const saver = await newSession('save_wins_submit_holder')
    const submitter = await newSession('save_wins_submit_waiter')
    assert.equal(await saver.run(`BEGIN; ${saveSql(6, revisionSql(6), 2)}`), 'true|false')
    const outcome = submitter.run(submitSql(6)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(submitter, saver)
    await saver.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.equal(result.value, 'false|assignment_doc_revision_conflict')
    await saver.close()
    await submitter.close()
    console.log('Passed: save_wins_submit')
  }

  // Restore/legacy-save and contextual save share the editor fence in either
  // ordering instead of waiting on each other's document/member locks.
  {
    const legacy = await newSession('legacy_save_wins_holder')
    const contextual = await newSession('legacy_save_wins_waiter')
    assert.equal(await legacy.run(`BEGIN; ${legacySaveSql(7)}`), 'true|ok')
    const outcome = contextual.run(saveSql(7, revisionSql(7), 2)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(contextual, legacy)
    await legacy.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.match(result.value, /^false\|$/)
    await legacy.close()
    await contextual.close()
    console.log('Passed: legacy_save_wins')
  }
  {
    const contextual = await newSession('contextual_save_wins_holder')
    const legacy = await newSession('contextual_save_wins_waiter')
    assert.equal(await contextual.run(`BEGIN; ${saveSql(8, revisionSql(8), 2)}`), 'true|false')
    const outcome = legacy.run(legacySaveSql(8)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(legacy, contextual)
    await contextual.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.equal(result.value, 'false|assignment_doc_save_superseded')
    await contextual.close()
    await legacy.close()
    console.log('Passed: contextual_save_wins')
  }

  // Unsubmit also holds the submission fence first. The waiting save observes
  // the changed revision rather than deadlocking or surfacing a database error.
  assert.equal(await admin.run(submitSql(9)), 'true|ok')
  {
    const unsubmitter = await newSession('unsubmit_wins_holder')
    const saver = await newSession('unsubmit_wins_waiter')
    assert.equal(await unsubmitter.run(`BEGIN; ${unsubmitSql(9)}`), 'true|ok')
    const outcome = saver.run(saveSql(9, revisionSql(9), 2)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(saver, unsubmitter)
    await unsubmitter.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.equal(result.value, 'false|')
    await unsubmitter.close()
    await saver.close()
    console.log('Passed: unsubmit_wins')
  }

  // If save owns the classroom fence, draft/archive transitions return the
  // established retry signal and succeed after the short save transaction.
  {
    const saver = await newSession('save_wins_draft_holder')
    const updater = await newSession('save_wins_draft_waiter')
    assert.equal(await saver.run(`BEGIN; ${saveSql(4, revisionSql(4), 2)}`), 'true|false')
    const outcome = await updater.run(
      `UPDATE public.assignments SET is_draft = true, released_at = null WHERE id = '${assignments[4]}';`,
    ).then((value) => ({ value }), (error) => ({ error }))
    assert.match(outcome.error?.message ?? '', /ERROR: +(40001|55P03):/)
    await saver.run('COMMIT;')
    await updater.close()
    assert.equal(await admin.run(
      `UPDATE public.assignments SET is_draft = true, released_at = null WHERE id = '${assignments[4]}'; SELECT is_draft FROM public.assignments WHERE id = '${assignments[4]}';`,
    ), 't')
    await saver.close()
    console.log('Passed: save_wins_draft')
  }
  {
    const saver = await newSession('save_wins_archive_holder')
    const updater = await newSession('save_wins_archive_waiter')
    assert.equal(await saver.run(`BEGIN; ${saveSql(8, revisionSql(8), 3)}`), 'true|false')
    const outcome = await updater.run(
      `UPDATE public.classrooms SET archived_at = clock_timestamp() WHERE id = '${classrooms[8]}';`,
    ).then((value) => ({ value }), (error) => ({ error }))
    assert.match(outcome.error?.message ?? '', /ERROR: +(40001|55P03):/)
    await saver.run('COMMIT;')
    await updater.close()
    assert.equal(await admin.run(
      `UPDATE public.classrooms SET archived_at = clock_timestamp() WHERE id = '${classrooms[8]}'; SELECT archived_at IS NOT NULL FROM public.classrooms WHERE id = '${classrooms[8]}';`,
    ), 't')
    await saver.close()
    console.log('Passed: save_wins_archive')
  }

  // Seed documents for the contextual submit/unsubmit lock-order cases.
  for (const index of [10, 11, 12, 13, 14, 15]) {
    assert.equal(await admin.run(saveSql(index)), 'true|true')
  }

  // Removal commits first: contextual submit rechecks exact enrollment and
  // cannot mutate the preserved document afterward.
  await blockingRace(
    'removal_wins_contextual_submit',
    `DELETE FROM public.classroom_enrollments WHERE classroom_id = '${classrooms[10]}' AND student_id = '${actor}';`,
    contextualSubmitSql(10),
    '42501',
  )
  assert.equal(
    await admin.run(`SELECT is_submitted FROM public.assignment_docs WHERE assignment_id = '${assignments[10]}' AND student_id = '${actor}';`),
    'f',
  )

  // An authorized contextual submit holds the membership fences until commit;
  // removal waits and revokes future access only after the submission exists.
  {
    const submitter = await newSession('contextual_submit_wins_removal_holder')
    const remover = await newSession('contextual_submit_wins_removal_waiter')
    assert.equal(await submitter.run(`BEGIN; ${contextualSubmitSql(11)}`), 'true|ok')
    const outcome = remover.run(
      `DELETE FROM public.classroom_enrollments WHERE classroom_id = '${classrooms[11]}' AND student_id = '${actor}';`,
    ).then((value) => ({ value }), (error) => ({ error }))
    await waitBlocked(remover, submitter)
    await submitter.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    await submitter.close()
    await remover.close()
    assert.equal(await admin.run(`SELECT NOT EXISTS (
      SELECT 1 FROM public.classroom_enrollments
      WHERE classroom_id = '${classrooms[11]}' AND student_id = '${actor}'
    ) AND EXISTS (
      SELECT 1 FROM public.assignment_docs
      WHERE assignment_id = '${assignments[11]}' AND student_id = '${actor}' AND is_submitted
    );`), 't')
    console.log('Passed: contextual_submit_wins_removal')
  }

  // Contextual submit and save share submission->editor ordering in both
  // directions, producing structured document conflicts rather than deadlocks.
  {
    const submitter = await newSession('contextual_submit_wins_save_holder')
    const saver = await newSession('contextual_submit_wins_save_waiter')
    assert.equal(await submitter.run(`BEGIN; ${contextualSubmitSql(12)}`), 'true|ok')
    const outcome = saver.run(saveSql(12, revisionSql(12), 2)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(saver, submitter)
    await submitter.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.match(result.value, /^false\|/)
    await submitter.close()
    await saver.close()
    console.log('Passed: contextual_submit_wins_save')
  }
  {
    const saver = await newSession('save_wins_contextual_submit_holder')
    const submitter = await newSession('save_wins_contextual_submit_waiter')
    assert.equal(await saver.run(`BEGIN; ${saveSql(13, revisionSql(13), 2)}`), 'true|false')
    const outcome = submitter.run(contextualSubmitSql(13)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(submitter, saver)
    await saver.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.equal(result.value, 'false|assignment_doc_revision_conflict')
    await saver.close()
    await submitter.close()
    console.log('Passed: save_wins_contextual_submit')
  }

  // Contextual unsubmit uses the same order. A waiting save or unsubmit sees
  // the committed state through established structured results.
  assert.equal(await admin.run(contextualSubmitSql(14)), 'true|ok')
  {
    const unsubmitter = await newSession('contextual_unsubmit_wins_save_holder')
    const saver = await newSession('contextual_unsubmit_wins_save_waiter')
    assert.equal(await unsubmitter.run(`BEGIN; ${contextualUnsubmitSql(14)}`), 'true|ok')
    const outcome = saver.run(saveSql(14, revisionSql(14), 2)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(saver, unsubmitter)
    await unsubmitter.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.match(result.value, /^false\|/)
    await unsubmitter.close()
    await saver.close()
    console.log('Passed: contextual_unsubmit_wins_save')
  }

  assert.equal(await admin.run(contextualSubmitSql(15)), 'true|ok')
  {
    const saver = await newSession('save_wins_contextual_unsubmit_holder')
    const unsubmitter = await newSession('save_wins_contextual_unsubmit_waiter')
    const saveOutcome = await saver.run(`BEGIN; ${saveSql(15, revisionSql(15), 2)}`)
    assert.match(saveOutcome, /^false\|/)
    const outcome = unsubmitter.run(contextualUnsubmitSql(15)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(unsubmitter, saver)
    await saver.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.equal(result.value, 'true|ok')
    await saver.close()
    await unsubmitter.close()
    console.log('Passed: save_wins_contextual_unsubmit')
  }

  // Seed documents and baseline history for contextual restore ordering.
  for (const index of [16, 17, 18, 19]) {
    assert.equal(await admin.run(saveSql(index)), 'true|true')
  }

  // Removal commits first: contextual restore rechecks current membership and
  // leaves the existing document unchanged.
  await blockingRace(
    'removal_wins_contextual_restore',
    `DELETE FROM public.classroom_enrollments WHERE classroom_id = '${classrooms[16]}' AND student_id = '${actor}';`,
    contextualRestoreSql(16),
    '42501',
  )
  assert.equal(
    await admin.run(`SELECT content #>> '{content,0,content,0,text}' FROM public.assignment_docs WHERE assignment_id = '${assignments[16]}' AND student_id = '${actor}';`),
    tag,
  )

  // An authorized restore holds the membership fence; removal can revoke only
  // after the exact history restore commits.
  {
    const restorer = await newSession('contextual_restore_wins_removal_holder')
    const remover = await newSession('contextual_restore_wins_removal_waiter')
    assert.equal(await restorer.run(`BEGIN; ${contextualRestoreSql(17)}`), 'true|ok')
    const outcome = remover.run(
      `DELETE FROM public.classroom_enrollments WHERE classroom_id = '${classrooms[17]}' AND student_id = '${actor}';`,
    ).then((value) => ({ value }), (error) => ({ error }))
    await waitBlocked(remover, restorer)
    await restorer.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    await restorer.close()
    await remover.close()
    assert.equal(await admin.run(`SELECT NOT EXISTS (
      SELECT 1 FROM public.classroom_enrollments
      WHERE classroom_id = '${classrooms[17]}' AND student_id = '${actor}'
    ) AND EXISTS (
      SELECT 1 FROM public.assignment_docs
      WHERE assignment_id = '${assignments[17]}' AND student_id = '${actor}'
        AND content #>> '{content,0,content,0,text}' = '${tag}_restored'
    );`), 't')
    console.log('Passed: contextual_restore_wins_removal')
  }

  // Restore and contextual save share submission->editor ordering in both
  // directions and surface structured revision conflicts instead of deadlocks.
  {
    const restorer = await newSession('contextual_restore_wins_save_holder')
    const saver = await newSession('contextual_restore_wins_save_waiter')
    assert.equal(await restorer.run(`BEGIN; ${contextualRestoreSql(18)}`), 'true|ok')
    const outcome = saver.run(saveSql(18, revisionSql(18), 2)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(saver, restorer)
    await restorer.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.match(result.value, /^false\|/)
    await restorer.close()
    await saver.close()
    console.log('Passed: contextual_restore_wins_save')
  }
  {
    const saver = await newSession('save_wins_contextual_restore_holder')
    const restorer = await newSession('save_wins_contextual_restore_waiter')
    assert.equal(await saver.run(`BEGIN; ${saveSql(19, revisionSql(19), 2)}`), 'true|false')
    const outcome = restorer.run(contextualRestoreSql(19)).then(
      (value) => ({ value }),
      (error) => ({ error }),
    )
    await waitBlocked(restorer, saver)
    await saver.run('COMMIT;')
    const result = await outcome
    if (result.error) throw result.error
    assert.equal(result.value, 'false|assignment_doc_revision_conflict')
    await saver.close()
    await restorer.close()
    console.log('Passed: save_wins_contextual_restore')
  }

  console.log('All contextual assignment save, submission, history, and restore concurrency contracts passed.')
} finally {
  try {
    const workers = sessions.filter((session) => session !== admin)
    if (workers.length) {
      await admin.run(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name IN (
        ${workers.map((session) => `'${session.name}'`).join(',')}
      );`)
    }
    await Promise.all(workers.map((session) => session.close()))
    if (fixturesCreated) {
      await admin.run(`BEGIN;
        DELETE FROM public.classrooms
        WHERE id IN (${classrooms.map((id) => `'${id}'`).join(',')})
          AND title = '${tag}' AND teacher_id = '${owner}';
        DELETE FROM public.users
        WHERE (id = '${actor}' AND email = '${tag}_actor@example.invalid')
          OR (id = '${owner}' AND email = '${tag}_owner@example.invalid');
        COMMIT;`)
      assert.equal(
        await admin.run(`SELECT
          (SELECT count(*) FROM public.classrooms WHERE id IN (${classrooms.map((id) => `'${id}'`).join(',')}))
          + (SELECT count(*) FROM public.users WHERE id IN ('${actor}', '${owner}'));`),
        '0',
        'Synthetic fixture cleanup must be complete',
      )
      console.log('Removed this run’s synthetic fixtures; no real classroom data was changed.')
    }
  } finally {
    await admin.close()
  }
}
