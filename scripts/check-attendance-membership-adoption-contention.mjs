import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const deadline = Date.now() + 30_000
// Only the existing offline-clone runner supplies this immutable identity.
// No shared/hosted target, container creation or automatic failed-run retry.
const args = process.argv.slice(2)
assert.equal(args.length, 4, 'Expected --container-id ID --owner LABEL')
assert.equal(args[0], '--container-id')
assert.equal(args[2], '--owner')
const containerId = args[1]
const ownerLabel = args[3]
assert.match(containerId, /^[a-f0-9]{64}$/)
assert.match(ownerLabel, /^[1-9][0-9]*:[A-Za-z0-9]+$/)

function verifyTarget() {
  assert.ok(Date.now() < deadline, 'Attendance contention exceeded 30 seconds')
  const inspected = JSON.parse(execFileSync('docker', ['inspect', containerId], {
    encoding: 'utf8', timeout: Math.min(5_000, Math.max(1, deadline - Date.now())), maxBuffer: 262_144,
  }))
  assert.equal(inspected.length, 1)
  const inspection = inspected[0]
  assert.equal(inspection.Id, containerId)
  assert.equal(inspection.Config.Labels?.['pika.attendance-membership.owner'], ownerLabel)
  assert.notEqual(inspection.Config.Labels?.['com.supabase.cli.project'], 'pika')
  assert.equal(inspection.HostConfig.NetworkMode, 'none')
  assert.equal(Object.keys(inspection.HostConfig.PortBindings ?? {}).length, 0)
  assert.ok(Object.values(inspection.NetworkSettings.Ports ?? {}).every(bindings => bindings === null || bindings.length === 0))
  assert.equal(inspection.State.Running, true)
}

// Validate source/profile before opening either SQL connection. The fixture is
// reused verbatim except its one terminal rollback, changed in memory only.
const fixture = readFileSync(new URL('./check-attendance-membership-adoption-database.sql', import.meta.url), 'utf8')
assert.equal(createHash('sha256').update(fixture).digest('hex'),
  '3b13503bcc8f6d708d29ba20de1614bae08499f3d7a634c95258a6da587a4ceb', 'Unexpected native fixture')
assert.equal([...fixture.matchAll(/^rollback;\s*$/gim)].length, 1)
assert.match(fixture, /rollback;\s*$/i)
const profile = readFileSync(new URL('./attendance-membership-adoption-reviewed-migration.ts', import.meta.url), 'utf8')
const sealedHash = profile.match(/sha256: '([a-f0-9]{64})'/)?.[1]
assert.ok(sealedHash, 'Missing reviewed285 seal')
const migration = readFileSync(new URL('../supabase/migrations/285_attendance_membership_adoption.sql', import.meta.url), 'utf8')
assert.equal(createHash('sha256').update(migration).digest('hex'), sealedHash)
verifyTarget()

const MAX_STREAM_BYTES = 262_144
function connection(label) {
  const child = spawn('docker', ['exec', '-i', containerId, 'psql', '-U', 'postgres',
    '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { stdio: 'pipe' })
  let pending
  let serial = 0
  let stdout = ''
  let stderr = ''
  let stdoutBytes = 0
  let stderrBytes = 0
  let failure
  let exited = false
  let onClosed
  const closed = new Promise(resolve => { onClosed = resolve })
  function abort(error) {
    failure ??= error
    pending?.reject(failure)
    pending = undefined
    child.stdin.destroy()
    child.kill('SIGTERM')
  }
  child.stdout.on('data', data => {
    stdoutBytes += data.length
    if (stdoutBytes > MAX_STREAM_BYTES) return abort(new Error(`${label} stdout exceeded bound`))
    stdout += data.toString()
    if (!pending) {
      if (stdout.trim()) abort(new Error(`${label} produced unsolicited output`))
      return
    }
    const marker = `${pending.marker}\n`
    const index = stdout.indexOf(marker)
    if (index < 0) return
    if ((index > 0 && stdout[index - 1] !== '\n') || stdout.slice(index + marker.length).trim()) {
      return abort(new Error(`${label} invalid response framing`))
    }
    const request = pending
    pending = undefined
    const output = stdout.slice(0, index).trim()
    stdout = ''
    stdoutBytes = 0
    request.resolve(output)
  })
  child.stderr.on('data', data => {
    stderrBytes += data.length
    if (stderrBytes > MAX_STREAM_BYTES) return abort(new Error(`${label} stderr exceeded bound`))
    stderr += data.toString()
  })
  child.on('error', abort)
  child.stdin.on('error', abort)
  child.on('close', code => {
    exited = true
    if (code !== 0 || pending) {
      failure ??= new Error(`${label} SQL exited ${code}: ${stderr}`)
      pending?.reject(failure)
      pending = undefined
    }
    onClosed()
  })
  return {
    run(sql) {
      if (failure) return Promise.reject(failure)
      if (exited) return Promise.reject(new Error(`${label} is closed`))
      if (pending) return Promise.reject(new Error(`${label} already has a query`))
      return new Promise((resolve, reject) => {
        const marker = `attendance285_${label}_${++serial}`
        pending = { marker, resolve, reject }
        child.stdin.write(`${sql}\n\\echo ${marker}\n`)
      })
    },
    abort,
    async close() {
      if (!exited) child.stdin.end()
      const killer = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 2_000)
      try {
        await closed
        if (failure) throw failure
      } finally { clearTimeout(killer) }
    },
  }
}

const holder = connection('holder')
const contender = connection('contender')
const timeout = setTimeout(() => {
  const error = new Error('Attendance contention exceeded 30 seconds')
  holder.abort(error)
  contender.abort(error)
}, Math.max(1, deadline - Date.now()))
const owner = "'f2850000-0000-4000-8000-000000000001'::uuid"
const learner = "'f2850000-0000-4000-8000-000000000002'::uuid"
const classroom = "'f2850000-0000-4000-8000-000000000010'::uuid"
const rosterId = "'f2850000-0000-4000-8000-000000000030'::uuid"
const prepare = `public.prepare_attendance_membership_snapshot_v1(${owner},${classroom},'2026-10-21','2026-10-21','exact_canary',${owner},${classroom})`
const remove = `public.remove_classroom_students_for_owner_v1(${owner},${classroom},array[${rosterId}])`
const literal = value => `'${value.replaceAll("'", "''")}'`
const queryJson = async (session, sql) => JSON.parse(await session.run(`select ${sql};`))
const state = session => queryJson(session, `jsonb_build_object(
  'scan',public.resolve_attendance_membership_scan_generation(${classroom},${learner}),
  'ref',(select participant_ref from public.attendance_participant_mappings where classroom_id=${classroom} and student_id=${learner}),
  'source',md5(public.attendance_roster_source_document_v1(${classroom})::text),
  'bindings',(select count(*) from private.attendance_membership_generations where scope_digest=private.pal_membership_scope(${classroom},${learner})),
  'associations',(select count(*) from private.attendance_participant_associations where scope_digest=private.pal_membership_scope(${classroom},${learner})),
  'capabilities',(select count(*) from private.attendance_pointer_mutations))`)
async function expectSqlError(session, expression, code, message) {
  assert.match(code, /^[A-Z0-9]{5}$/)
  await session.run(`begin; set local statement_timeout='3s'; do $$ begin
    begin perform ${expression}; raise exception 'Unexpected RPC success';
    exception when sqlstate '${code}' then
      if sqlerrm is distinct from ${literal(message)} then raise; end if;
    end;
  end $$; rollback;`)
}
function assertPrepared(prepared, baseline) {
  assert.equal(prepared.roster_source_token, baseline.source)
  assert.equal(prepared.participants.find(row => row.student_id === 'f2850000-0000-4000-8000-000000000002')?.participant_ref, baseline.ref)
}

let operationError
try {
  await holder.run("set statement_timeout='3s'; set lock_timeout='1s';")
  await contender.run("set statement_timeout='3s'; set lock_timeout='1s';")
  // Committed synthetic rows exist ONLY in this owned offline clone. The source
  // fixture remains rollback-only for every normal invocation.
  await holder.run(fixture.replace(/rollback;\s*$/i, 'commit;'))
  await holder.run(`begin;
    insert into public.classroom_roster(id,classroom_id,email)
      values(${rosterId},${classroom},'membership-learner-teacher@example.invalid');
    commit;`)
  const baseline = await state(contender)
  assert.equal(baseline.scan.status, 'active')
  assert.equal(baseline.scan.generation_id, 'f2850000-0000-4000-8000-000000000022')
  assert.match(baseline.ref, /^participant_[a-f0-9]{32}$/)
  assert.equal(baseline.scan.participant_ref, baseline.ref)
  assert.match(baseline.source, /^[a-f0-9]{32}$/)
  assert.equal(baseline.bindings, 2)
  assert.equal(baseline.associations, 3)
  assert.equal(baseline.capabilities, 0)

  // 1: real concurrent preparation, then a fresh committed-snapshot retry.
  await holder.run('begin;')
  assertPrepared(await queryJson(holder, prepare), baseline)
  await expectSqlError(contender, prepare, '40001', 'classroom_operation_busy')
  await holder.run('commit;')
  assertPrepared(await queryJson(contender, prepare), baseline)
  const retried = await state(contender)
  assert.deepEqual(retried, baseline)

  // Save an actual staged roster for the later removal/staging race.
  const prepared = await queryJson(holder, prepare)
  const message = {
    schema_version: 1, message_type: 'roster.snapshot',
    idempotency_key: `fixture285:roster:${prepared.roster_revision}`,
    correlation_ref: 'fixture285', installation_ref: 'fixture285',
    roster_ref: prepared.roster_ref, revision: prepared.roster_revision,
    owner_principal_ref: prepared.owner_principal_ref,
    display_name: prepared.title, owner_display_name: 'Pika teacher',
    participants: prepared.participants.map(({ student_id: _studentId, ...participant }) => participant),
  }
  const stage = `public.stage_attendance_membership_roster_snapshot_v1(${owner},${classroom},${literal(prepared.roster_source_token)},${literal(JSON.stringify(message))}::jsonb,'exact_canary',${owner},${classroom})`
  const staged = await queryJson(holder, stage)
  assert.equal(staged.status, 'pending')
  assert.match(staged.outbox_id, /^[a-f0-9-]{36}$/)

  // 2: preparation holds the real lock;236 must reject preserving removal.
  await holder.run('begin;')
  assertPrepared(await queryJson(holder, prepare), baseline)
  await expectSqlError(contender, remove, 'PT409', 'Roster operation busy')
  await holder.run('rollback;')
  assert.deepEqual(await state(contender), baseline)

  // 3: actual preserving removal holds the lock; both new APIs must conflict.
  await holder.run('begin;')
  const removed = await queryJson(holder, remove)
  assert.equal(removed.removed_count, 1)
  await expectSqlError(contender, prepare, '40001', 'classroom_operation_busy')
  await expectSqlError(contender, stage, '40001', 'classroom_operation_busy')
  await holder.run('commit;')
  const closed = await state(contender)
  assert.deepEqual(closed.scan, { status: 'forbidden' })
  assert.equal(closed.ref, baseline.ref)
  assert.equal(closed.bindings, baseline.bindings)
  assert.equal(closed.associations, baseline.associations)
  assert.equal(closed.capabilities, 0)
  assert.notEqual(closed.source, baseline.source)
  await expectSqlError(contender, stage, '40001', 'attendance_roster_source_changed')
  const retained = await queryJson(contender, `jsonb_build_object(
    'closed',private.attendance_participant_generation_closed(${literal(baseline.ref)}),
    'superseded',exists(select 1 from public.attendance_integration_outbox where id=${literal(staged.outbox_id)}::uuid and status='superseded'),
    'authorized',public.authorize_attendance_generation_delivery(${literal(staged.outbox_id)}::uuid,null,${literal(JSON.stringify(message))}::jsonb),
    'facts',(select count(*) from public.attendance_check_in_facts where classroom_id=${classroom} and student_id=${learner}))`)
  assert.deepEqual(retained, { closed: true, superseded: true, authorized: false, facts: 5 })
  verifyTarget()
} catch (error) {
  operationError = error
} finally {
  const closures = await Promise.allSettled([holder.close(), contender.close()])
  clearTimeout(timeout)
  const errors = [operationError, ...closures.filter(result => result.status === 'rejected').map(result => result.reason)].filter(Boolean)
  if (errors.length) throw new AggregateError([...new Set(errors)], 'Attendance contention or SQL connection closure failed')
}
console.log('PASS: prepare/prepare stable committed retry; prepare/remove conflict; remove/prepare/stage conflict and fresh stale-delivery denial; retained facts, no capability residue, and both SQL connections closed successfully.')
