import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { setTimeout as delay } from 'node:timers/promises'

// The repository's TypeScript modules are loaded as CommonJS by tsx. Resolve
// the actual offline builder through its supported require hook from this file.
const require = createRequire(import.meta.url)
const { prepareClassroomAdmissionManifest } = require('../src/lib/server/classroom-admission-manifest.ts')

// This proof accepts only the exact offline clone identity supplied by its owner.
// It never creates a container, contacts a provider or targets the shared stack.
const args = process.argv.slice(2)
assert.equal(args.length, 4)
assert.equal(args[0], '--container-id')
assert.equal(args[2], '--owner')
const containerId = args[1]
const owner = args[3]
assert.match(containerId, /^[a-f0-9]{64}$/u)
assert.match(owner, /^[1-9][0-9]*:[A-Za-z0-9]+$/u)
const deadline = Date.now() + 30_000
const MAX_STREAM_BYTES = 262_144
const remaining = () => Math.min(5_000, Math.max(1, deadline - Date.now()))
function verifyTarget() {
  assert.ok(Date.now() < deadline, 'Admission contention exceeded 30 seconds')
  const inspected = JSON.parse(execFileSync('docker', ['inspect', containerId], {
    encoding: 'utf8', timeout: remaining(), maxBuffer: MAX_STREAM_BYTES,
  }))
  assert.equal(inspected.length, 1)
  const target = inspected[0]
  assert.equal(target.Id, containerId)
  assert.equal(target.Config.Labels?.['pika.home-visibility.owner'], owner)
  assert.notEqual(target.Config.Labels?.['com.supabase.cli.project'], 'pika')
  assert.equal(target.HostConfig.NetworkMode, 'none')
  assert.equal(Object.keys(target.HostConfig.PortBindings ?? {}).length, 0)
  assert.ok(Object.values(target.NetworkSettings.Ports ?? {}).every(bindings => bindings === null || bindings.length === 0))
  assert.equal(target.State.Running, true)
}
verifyTarget()
const sqlArgs = ['exec', '-i', containerId, 'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1']
function sql(input) {
  verifyTarget()
  return execFileSync('docker', sqlArgs, {
    input: `set statement_timeout='3s'; set lock_timeout='2s';\n${input}`,
    encoding: 'utf8', timeout: remaining(), maxBuffer: MAX_STREAM_BYTES,
  }).trim()
}
function fingerprint() {
  verifyTarget()
  // Include all public/private schema, data, ACLs and trigger state. pg_dump's
  // randomized session guard is the only normalization; no rows are filtered.
  const dump = execFileSync('docker', ['exec', containerId, 'pg_dump', '-U', 'postgres', '-d', 'postgres',
    '--schema=public', '--schema=private', '--no-owner'], {
    encoding: 'utf8', timeout: remaining(), maxBuffer: 8_388_608,
  }).replace(/^\\(?:un)?restrict .*\n/gmu, '')
  return createHash('sha256').update(dump).digest('hex')
}
function connection(label) {
  verifyTarget()
  const child = spawn('docker', sqlArgs, { stdio: 'pipe' })
  let pending, failure, exited = false, serial = 0
  let stdout = '', stderr = '', stdoutBytes = 0, stderrBytes = 0
  const closed = new Promise(resolve => child.on('close', code => {
    exited = true
    if (code !== 0 || pending) {
      failure ??= new Error(`Admission ${label} SQL exited ${code}: ${stderr}`)
      pending?.reject(failure)
      pending = undefined
    }
    resolve()
  }))
  function abort(error) {
    failure ??= error
    pending?.reject(failure)
    pending = undefined
    child.stdin.destroy()
    child.kill('SIGTERM')
  }
  child.on('error', abort)
  child.stdin.on('error', abort)
  child.stderr.on('data', data => {
    stderrBytes += data.length
    if (stderrBytes > MAX_STREAM_BYTES) return abort(new Error('Admission stderr exceeded bound'))
    stderr += data.toString()
  })
  child.stdout.on('data', data => {
    stdoutBytes += data.length
    if (stdoutBytes > MAX_STREAM_BYTES) return abort(new Error('Admission stdout exceeded bound'))
    stdout += data.toString()
    if (!pending) {
      if (stdout.trim()) abort(new Error('Admission unsolicited SQL output'))
      return
    }
    const marker = `${pending.marker}\n`
    const index = stdout.indexOf(marker)
    if (index < 0) return
    if ((index > 0 && stdout[index - 1] !== '\n') || stdout.slice(index + marker.length).trim()) {
      return abort(new Error('Admission response framing invalid'))
    }
    const request = pending
    pending = undefined
    const result = stdout.slice(0, index).trim()
    stdout = ''; stdoutBytes = 0
    request.resolve(result)
  })
  return {
    run(input) {
      assert.equal(pending, undefined)
      if (failure || exited) return Promise.reject(failure ?? new Error('Admission connection closed'))
      return new Promise((resolve, reject) => {
        const marker = `admission294_${label}_${++serial}`
        pending = { marker, resolve, reject }
        child.stdin.write(`${input}\n\\echo ${marker}\n`)
      })
    },
    abort,
    async close() {
      if (!exited) child.stdin.end('rollback;\n\\q\n')
      const killer = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 2_000)
      try { await closed; if (failure) throw failure } finally { clearTimeout(killer) }
    },
  }
}
const literal = value => `'${value.replaceAll("'", "''")}'`
const uuidArray = values => `array[${values.map(literal).join(',')}]::uuid[]`
const userId = n => `f294c000-0000-4000-8000-${String(n).padStart(12, '0')}`
const operationId = n => `f294d000-0000-4000-8000-${String(n).padStart(12, '0')}`
const users = Array.from({ length: 74 }, (_, i) => userId(i + 1))
const bootstrap = users.slice(0, 70)
const operations = []
function operation(n, revision, kind, userIds = [], excludedUserIds = []) {
  const request = prepareClassroomAdmissionManifest({ operationId: operationId(n), expectedRevision: revision,
    kind, userIds, excludedUserIds, approvalRef: `fixture/admission294-${n}` })
  assert.equal(sql(`select private.classroom_experience_admission_manifest_v2(${literal(kind)},${uuidArray(request.p_user_ids)},${uuidArray(request.p_excluded_user_ids)});`),
    request.p_manifest_sha256, 'Actual offline TypeScript manifest must match PostgreSQL digest')
  operations.push(request.p_operation_id)
  return `public.commit_classroom_experience_admission_batch_v2(${literal(request.p_operation_id)},${revision},${literal(kind)},${uuidArray(request.p_user_ids)},${uuidArray(request.p_excluded_user_ids)},${literal(request.p_manifest_sha256)},${literal(request.p_approval_ref)})`
}
const queryJson = async (session, expression) => JSON.parse(await session.run(`set role service_role; select coalesce(to_jsonb(${expression}),'null'::jsonb); reset role;`))
function expectedError(expression, state, message) {
  return `set role service_role; do $proof$ begin
    begin perform ${expression}; raise exception 'Expected admission rejection';
    exception when others then
      if sqlstate is distinct from '${state}' or sqlerrm is distinct from '${message}' then raise; end if;
    end;
  end $proof$; reset role;`
}
const before = fingerprint()
// The rollback-only fixture must leave migration294 inactive and synthetic IDs absent.
assert.deepEqual(JSON.parse(sql(`select jsonb_build_object('policy',(select to_jsonb(p) from private.classroom_experience_admission_policy p),
 'grants',(select count(*) from private.classroom_experience_admission_grants),
 'batches',(select count(*) from private.classroom_experience_admission_batches),
 'exclusions',(select count(*) from private.classroom_experience_admission_exclusions),
 'users',(select count(*) from public.users where id=any(${uuidArray(users)})));`)), {
  policy: { singleton: true, registry_revision: 0, growth_enabled: false, bootstrap_initialized: false, bootstrap_manifest_sha256: null },
  grants: 0, batches: 0, exclusions: 0, users: 0,
})
// Build every request before acquiring policy locks, and prove builder/SQL parity.
const boot = operation(1, 0, 'bootstrap', bootstrap, [users[73]])
const on = operation(2, 1, 'growth_on')
const stopFirst = operation(3, 2, 'growth_off')
const rejected = operation(4, 2, 'operator', [users[70]])
const rejectedAfterStop = operation(5, 3, 'operator', [users[70]])
const resume = operation(6, 3, 'growth_on')
const batchFirst = operation(7, 4, 'operator', [users[70]])
const stopAfterBatch = operation(8, 5, 'growth_off')
const resumeDuplicate = operation(9, 6, 'growth_on')
const duplicate = operation(10, 7, 'operator', [users[71]])
const unknown = operation(11, 8, 'operator', [users[72]])
const holder = connection('holder')
const waiter = connection('waiter')
const timer = setTimeout(() => {
  const error = new Error('Admission contention exceeded 30 seconds')
  holder.abort(error); waiter.abort(error)
}, Math.max(1, deadline - Date.now()))
let fixturesCreated = false
let operationError
let holderPid, waiterPid
async function observeLock() {
  let observed = false
  for (let attempt = 0; attempt < 20; attempt++) {
    if (sql(`select count(*) from pg_stat_activity where pid=${waiterPid} and wait_event_type='Lock' and ${holderPid}=any(pg_blocking_pids(pid));`) === '1') {
      observed = true; break
    }
    await delay(50)
  }
  assert.ok(observed, 'Actual second-session policy row lock wait was not observed')
}
async function raced(waitingQuery, finishHolder) {
  // Attach rejection immediately so a failed contender cannot become unhandled.
  const pending = waiter.run(waitingQuery).then(value => ({ value }), error => ({ error }))
  await observeLock()
  await holder.run(finishHolder)
  const result = await pending
  if (result.error) throw result.error
  return result.value
}
function state() {
  return JSON.parse(sql(`select jsonb_build_object('revision',p.registry_revision,'growth',p.growth_enabled,
    'grants',(select count(*) from private.classroom_experience_admission_grants),
    'batches',(select count(*) from private.classroom_experience_admission_batches),
    'exclusions',(select count(*) from private.classroom_experience_admission_exclusions))
    from private.classroom_experience_admission_policy p;`))
}
try {
  await holder.run("set statement_timeout='5s'; set lock_timeout='2s';")
  await waiter.run("set statement_timeout='5s'; set lock_timeout='2s';")
  holderPid = Number(await holder.run('select pg_backend_pid();'))
  waiterPid = Number(await waiter.run('select pg_backend_pid();'))
  assert.ok(Number.isInteger(holderPid) && holderPid > 0)
  assert.ok(Number.isInteger(waiterPid) && waiterPid > 0)
  assert.notEqual(holderPid, waiterPid, 'Proof requires two actual PostgreSQL connections')
  sql(`begin; insert into public.users(id,email,role) values ${users.map((id, i) => `(${literal(id)},'admission294-${i + 1}@example.invalid','student')`).join(',')}; commit;`)
  fixturesCreated = true
  assert.equal((await queryJson(holder, boot)).registry_revision, 1)
  assert.equal((await queryJson(holder, on)).registry_revision, 2)

  // Stop commits first: the already waiting batch must refuse its old revision.
  await holder.run('begin;')
  assert.equal((await queryJson(holder, stopFirst)).registry_revision, 3)
  await raced(expectedError(rejected, '40001', 'classroom_admission_revision_conflict'), 'commit;')
  await waiter.run(expectedError(rejectedAfterStop, '55000', 'classroom_admission_growth_stopped'))
  assert.deepEqual(state(), { revision: 3, growth: false, grants: 70, batches: 3, exclusions: 1 })
  console.log('PASS stop-first: actual blocking, stale batch rejected, fresh batch growth-stopped, no partial grant')

  assert.equal((await queryJson(holder, resume)).registry_revision, 4)
  // Batch commits first: the waiting stop commits next and retains the grant.
  await holder.run('begin;')
  const admitted = await queryJson(holder, batchFirst)
  const stopped = JSON.parse(await raced(`set role service_role; select ${stopAfterBatch}; reset role;`, 'commit;'))
  assert.equal(admitted.registry_revision, 5)
  assert.equal(stopped.registry_revision, 6)
  assert.deepEqual(state(), { revision: 6, growth: false, grants: 71, batches: 6, exclusions: 1 })
  const retained = await queryJson(waiter, `public.read_classroom_experience_admission_v2(${literal(users[70])})`)
  assert.equal(retained.admitted, true)
  assert.equal(retained.bootstrap_member, false)
  assert.equal(retained.registry_revision, 6)
  console.log('PASS batch-first: actual blocking, committed grant retained after growth stop')

  assert.equal((await queryJson(holder, resumeDuplicate)).registry_revision, 7)
  await holder.run('begin;')
  const first = await queryJson(holder, duplicate)
  const replay = JSON.parse(await raced(`set role service_role; select ${duplicate}; reset role;`, 'commit;'))
  assert.deepEqual(replay, first)
  assert.deepEqual(state(), { revision: 8, growth: true, grants: 72, batches: 8, exclusions: 1 })
  assert.equal(sql(`select count(*) from private.classroom_experience_admission_batches where operation_id=${literal(operationId(10))};`), '1')
  console.log('PASS duplicate: actual blocking, one ledger operation, one grant, no extra revision')

  assert.equal(await queryJson(waiter, `public.read_classroom_experience_admission_operation_v2(${literal(operationId(11))})`), null)
  // Discard the writer result/COMMIT receipt; another real connection must
  // reconcile the committed operation before any exact retry. This models a
  // client-unknown outcome, without claiming a transport-failure injection.
  assert.equal(await holder.run(`begin;\n\\o /dev/null\nset local role service_role; select ${unknown}; commit;\n\\o`), '')
  const reconciled = await queryJson(waiter, `public.read_classroom_experience_admission_operation_v2(${literal(operationId(11))})`)
  assert.equal(reconciled.operation_id, operationId(11))
  assert.equal(reconciled.registry_revision, 9)
  assert.deepEqual(await queryJson(waiter, unknown), reconciled)
  assert.deepEqual(state(), { revision: 9, growth: true, grants: 73, batches: 9, exclusions: 1 })
  console.log('PASS unknown outcome: discarded writer receipt reconciled by independent committed read before exact retry')
} catch (error) {
  operationError = error
} finally {
  const closures = await Promise.allSettled([holder.close(), waiter.close()])
  const errors = [operationError, ...closures.filter(result => result.status === 'rejected').map(result => result.reason)].filter(Boolean)
  try {
    if (fixturesCreated) {
      verifyTarget()
      // Owner-only disposable-clone cleanup. Never truncate or delete unknown
      // rows. Immutable triggers are disabled only inside this cleanup transaction
      // and restored before commit; failure rolls back both data and DDL.
      sql(`begin; lock table private.classroom_experience_admission_policy,
        private.classroom_experience_admission_batches, private.classroom_experience_admission_grants,
        private.classroom_experience_admission_exclusions in access exclusive mode;
        do $scope$ begin
          if exists(select 1 from private.classroom_experience_admission_batches where operation_id<>all(${uuidArray(operations)}))
            or exists(select 1 from private.classroom_experience_admission_grants where user_id<>all(${uuidArray(users)}))
            or exists(select 1 from private.classroom_experience_admission_exclusions where user_id<>all(${uuidArray(users)})) then
            raise exception 'Admission cleanup found foreign state';
          end if;
        end $scope$;
        alter table private.classroom_experience_admission_grants disable trigger classroom_admission_grant_immutable;
        alter table private.classroom_experience_admission_exclusions disable trigger classroom_admission_exclusion_immutable;
        alter table private.classroom_experience_admission_batches disable trigger classroom_admission_batch_immutable;
        alter table private.classroom_experience_admission_policy disable trigger classroom_admission_policy_guard;
        delete from private.classroom_experience_admission_grants where user_id=any(${uuidArray(users)}) and origin_operation_id=any(${uuidArray(operations)});
        delete from private.classroom_experience_admission_exclusions where user_id=any(${uuidArray(users)}) and origin_operation_id=any(${uuidArray(operations)});
        delete from private.classroom_experience_admission_batches where operation_id=any(${uuidArray(operations)});
        update private.classroom_experience_admission_policy set registry_revision=0,growth_enabled=false,bootstrap_initialized=false,bootstrap_manifest_sha256=null where singleton;
        alter table private.classroom_experience_admission_grants enable trigger classroom_admission_grant_immutable;
        alter table private.classroom_experience_admission_exclusions enable trigger classroom_admission_exclusion_immutable;
        alter table private.classroom_experience_admission_batches enable trigger classroom_admission_batch_immutable;
        alter table private.classroom_experience_admission_policy enable trigger classroom_admission_policy_guard;
        delete from public.users where id=any(${uuidArray(users)});
        commit;`)
    }
    assert.equal(fingerprint(), before, 'Admission fixture cleanup must restore the complete application graph, ACLs and trigger state')
  } catch (error) { errors.push(error) }
  clearTimeout(timer)
  if (errors.length) throw new AggregateError([...new Set(errors)], 'Admission contention or owned fixture cleanup failed')
}
console.log('PASS admission fixture cleanup: exact preproof graph/schema fingerprint restored; both SQL sessions closed')
