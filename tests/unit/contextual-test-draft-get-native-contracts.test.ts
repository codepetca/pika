import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssertionError } from 'node:assert'
import { EventEmitter } from 'node:events'
import { readdirSync } from 'node:fs'
import { PassThrough, Writable } from 'node:stream'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), inventory: vi.fn(),
  snapshotSqlReads: false, sourceDrift: false, sqlFileCache: new Map<string, string>() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFile: mocks.execFile, execFileSync: vi.fn() }))
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, realpathSync: (path: string) => path === '/private/tmp/pika-test-native-docker.sock' ? path : actual.realpathSync(path),
    readFileSync: ((path, options) => {
      // Offline transport tests use immutable fixture bytes, but still execute every source-hash guard.
      if (mocks.snapshotSqlReads && typeof path === 'string' && options === 'utf8'
        && /\/supabase\/migrations\/\d{3}_[a-z0-9_]+\.sql$/.test(path)) {
        let source = mocks.sqlFileCache.get(path)
        if (source === undefined) { source = actual.readFileSync(path, 'utf8'); mocks.sqlFileCache.set(path, source) }
        return mocks.sourceDrift && path.endsWith('/247_contextual_test_draft_owner_get.sql')
          ? `${source}\n-- offline source drift` : source
      }
      return actual.readFileSync(path, options)
    }) as typeof actual.readFileSync,
    statSync: (path: string) => path === '/private/tmp/pika-test-native-docker.sock' ? { isSocket: () => true, dev: 1, ino: 2, mode: 3, rdev: 4 } : actual.statSync(path) }
})
vi.mock('../../scripts/contextual-test-owner-list-proof-inventory', () => ({ testOwnerListDockerInventory: mocks.inventory }))
import { buildDraftGetNativeContractsManifest, createDraftGetNativeContracts, validateDraftGetNativeSql, draftGetNativeTerminationSql, createDraftGetNativeDiagnostic } from '../../scripts/contextual-test-draft-get-native-contracts'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { DRAFT_GET_CAPS, runDraftGetContracts, type DraftGetDriver } from '../../scripts/check-contextual-test-draft-get-db-contracts'
import { runDraftGetConcurrency } from '../../scripts/check-contextual-test-draft-get-concurrency'
import { assignmentListExpectedResources } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'

describe('inert native Test draft GET contracts', () => {
  const original = newAssignmentListProofFixture()
  const repository = process.cwd()
  const head = '7570a9d60591183f0699001f47a6528045a392ee'
  it('performs no native operation when imported or preparing its finite manifest', () => {
    const manifest = buildDraftGetNativeContractsManifest(original, head, repository)
    expect(manifest.concurrency.schedules).toHaveLength(DRAFT_GET_CAPS.schedules)
    expect(manifest.fixture.allowedFixtureIds).toHaveLength(10016)
    expect(manifest.setup).toContain('commit;')
    expect(manifest.termination).toBe(draftGetNativeTerminationSql())
    expect(Object.isFrozen(manifest.concurrency.schedules)).toBe(true)
    expect(Object.isFrozen(manifest.concurrency.schedules[0])).toBe(true)
    expect(() => { (manifest.concurrency.schedules[0] as { holderSql: string }).holderSql = 'delete from public.users;' }).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.execFile).not.toHaveBeenCalled(); expect(mocks.inventory).not.toHaveBeenCalled()
  })
  it('accepts only exact manifest SQL and a lowercase opaque source SHA substitution', () => {
    const manifest = buildDraftGetNativeContractsManifest(original, head, repository)
    const template = manifest.concurrency.schedules[0].finalTemplate
    expect(validateDraftGetNativeSql(manifest, template.replace('0'.repeat(64), 'a'.repeat(64)))).toBe(true)
    expect(validateDraftGetNativeSql(manifest, template.replace('0'.repeat(64), 'A'.repeat(64)))).toBe(false)
    expect(validateDraftGetNativeSql(manifest, 'delete from public.users;')).toBe(false)
    expect(validateDraftGetNativeSql(manifest, `${template} select 1;`)).toBe(false)
  })
  it('rejects arbitrary head identities before opening anything', () => {
    expect(() => buildDraftGetNativeContractsManifest(original, 'main', repository)).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('binds remote termination to captured pid/start, reserved name, database and user', () => {
    const sql = draftGetNativeTerminationSql()
    expect(sql).toContain("pid=:'owned_pid'::integer")
    expect(sql).toContain("backend_start=:'owned_started'::timestamptz")
    expect(sql).toContain("application_name=:'owned_name'")
    expect(sql).toContain("datname='postgres'"); expect(sql).toContain("usename='postgres'")
    expect(sql).toContain('pg_terminate_backend(pid,5000)')
  })
})

describe('native persistent-session transport with offline child mocks', () => {
  const original = newAssignmentListProofFixture()
  const head = '7570a9d60591183f0699001f47a6528045a392ee'
  const repository = process.cwd()
  const manifest = buildDraftGetNativeContractsManifest(original, head, repository)
  const project = manifest.fixture.projectId
  const resources = assignmentListExpectedResources(project).map((r, index) => ({ ...r, id: (index + 1).toString(16).padStart(64, '0'), createdAt: '2026-10-05T00:00:00Z',
    labels: { 'com.supabase.cli.project': project, 'com.docker.compose.project': project }, attachedIds: [], ports: r.name.startsWith('supabase_db_') && r.kind === 'container' ? [54332] : [] }))
  const children: Array<EventEmitter & { stdin: Writable; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = []
  const terminations: string[][] = []
  const sqlControls: Array<{ args: string[]; sql: string }> = []
  let hangingSetup = false; let failContender = false; let terminationConfirmed = true; let privateFrame = false; let failBounds = false
  let wrongSnapshotActor = false; let failWrongActorTermination = false; let finalSnapshotChanged = false
  const holderCount = () => mocks.spawn.mock.calls.filter(call => call[1].includes(`PGAPPNAME=${project}_draft_holder`)).length
  let serviceExecute = true; let fixtureChanged = false; let catalogChanged = false; let restorationFails = false; let publicGrant = false
  const catalog = () => ({ owner: 'postgres', definition: catalogChanged ? 'changed function' : 'reviewed function',
    acl: [{ grantor: 'postgres', grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ...(serviceExecute ? [{ grantor: 'postgres', grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }] : []),
      ...(publicGrant ? [{ grantor: 'postgres', grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }] : [])] })
  const factory = () => createDraftGetNativeContracts({ repository, reviewedHead: head, original, capturedResources: resources,
    containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id, acceptedManifestSha256: testOwnerDigest(JSON.stringify(manifest)) })
  beforeEach(() => {
    mocks.snapshotSqlReads = true; mocks.sourceDrift = false; mocks.sqlFileCache.clear()
    vi.clearAllMocks(); children.length = 0; terminations.length = 0; sqlControls.length = 0; hangingSetup = false; failContender = false; terminationConfirmed = true; privateFrame = false; failBounds = false
    wrongSnapshotActor = false; failWrongActorTermination = false; finalSnapshotChanged = false
    serviceExecute = true; fixtureChanged = false; catalogChanged = false; restorationFails = false; publicGrant = false
    mocks.inventory.mockResolvedValue(resources)
    mocks.execFile.mockImplementation((file: string, args: string[], _options: unknown, callback: (error: unknown, stdout: string) => void) => {
      const child = new EventEmitter() as EventEmitter & { stdin: Writable; kill: ReturnType<typeof vi.fn> }
      let input = ''
      child.kill = vi.fn(() => true)
      child.stdin = new Writable({ write(chunk, _encoding, done) { input += String(chunk); done() }, final(done) {
        sqlControls.push({ args: [...args], sql: input })
        queueMicrotask(() => {
          if (file === 'git') callback(null, args[1] === '--show-toplevel' ? repository : args[0] === 'rev-parse' ? head : '')
          else if (args[0] === 'context') callback(null, JSON.stringify({ endpoints: { docker: { Host: 'unix:///private/tmp/pika-test-native-docker.sock', SkipTLSVerify: false } }, tlsMaterial: null }))
          else if (input === manifest.termination) { terminations.push(args); callback(null, JSON.stringify({ present: true, terminated: terminationConfirmed })) }
          else if (input === manifest.privilege.restore) {
            if (restorationFails) callback(Error('private grant restore failure'), '')
            else { serviceExecute = true; callback(null, '') }
          }
          else if (input === manifest.privilege.catalog) callback(null, JSON.stringify(catalog()))
          else if (input === manifest.snapshot) callback(null, JSON.stringify({ wholeRows: fixtureChanged ? 'changed' : 'unchanged' }))
          else callback(null, 'ok')
        }); done()
      } })
      return child
    })
    mocks.spawn.mockImplementation((_file: string, args: string[]) => {
      const child = new EventEmitter() as typeof children[number]
      const name = args.find(arg => arg.startsWith('PGAPPNAME='))!.slice('PGAPPNAME='.length)
      const pid = children.length + 1000
      child.stdout = new PassThrough(); child.stderr = new PassThrough()
      child.kill = vi.fn(() => { queueMicrotask(() => child.emit('close', 0)); return true })
      child.stdin = new Writable({ write(chunk, _encoding, done) {
        const text = String(chunk); const end = text.match(/\\echo (__draft_get_end_[0-9]+__)/)![1]
        const sql = text.slice(0, text.indexOf('\n\\echo'))
        let response = ''
        if (sql === manifest.bootstrap) response = JSON.stringify({ pid, started: '2026-10-05T00:00:00+00:00', name, database: 'postgres', user: 'postgres' })
        else if (sql === manifest.setup && privateFrame) response = 'PRIVATE SQL password=do-not-export'
        else if (sql === manifest.contracts.boundsAndDrift && failBounds) { queueMicrotask(() => child.emit('close', 7)); done(); return }
        else if (sql === manifest.setup && hangingSetup) { done(); return }
        else if (sql === manifest.snapshot) response = JSON.stringify({ wholeRows: finalSnapshotChanged && holderCount() === DRAFT_GET_CAPS.schedules ? 'PRIVATE changed rows token=secret' : fixtureChanged ? 'changed' : 'unchanged' })
        else if (sql === manifest.privilege.catalog) response = JSON.stringify(catalog())
        else if (sql === manifest.privilege.revoke) serviceExecute = false
        else if (sql.includes('select public.snapshot_test_draft_for_owner_v1')) {
          const testId = sql.match(/_v1\('[a-f0-9-]+','([a-f0-9-]+)'/)![1]
          response = JSON.stringify({ version: 1, actor_id: wrongSnapshotActor ? manifest.fixture.outsider : manifest.fixture.owner, classroom: { id: manifest.fixture.classroom, teacher_id: manifest.fixture.owner },
            test: { id: testId, classroom_id: manifest.fixture.classroom }, source_sha256: 'a'.repeat(64) })
          if (wrongSnapshotActor && failWrongActorTermination) terminationConfirmed = false
        } else if (sql.startsWith('select public.finish_test_draft_get_for_owner_v1')) {
          const row = manifest.concurrency.schedules.find(s => sql.includes(s.testId) && sql.includes(`'${s.operation}'`))!
          response = JSON.stringify({ operation: row.operation, test_id: row.testId })
        } else if (sql.startsWith('do $race$') && failContender) {
          queueMicrotask(() => child.emit('close', 1)); done(); return
        }
        queueMicrotask(() => child.stdout.write(`${response ? `${response}\n` : ''}${end}\n`)); done()
      } })
      children.push(child); return child
    })
  })
  afterEach(() => { vi.useRealTimers(); mocks.snapshotSqlReads = false; mocks.sourceDrift = false; mocks.sqlFileCache.clear() })
  it('snapshots the complete offline SQL fixture and still rejects changed source before work', async () => {
    const adapter = factory(); await adapter.setup()
    expect(mocks.sqlFileCache.size).toBe(readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).length)
    const dispatchedSql = sqlControls.length
    const spawnedChildren = children.length
    mocks.sourceDrift = true
    await expect(adapter.run()).rejects.toThrow('Expected values to be strictly equal')
    expect(sqlControls.slice(dispatchedSql).every(control => control.args[0] === 'rev-parse' || control.args[0] === 'status')).toBe(true)
    expect(children).toHaveLength(spawnedChildren)
    expect(children.every(child => child.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
  })
  // All 12 mocked schedules repeatedly hash the complete migration inventory;
  // allow bounded coverage overhead for this full-protocol regression.
  it('runs the finite protocol through persistent sessions and binds every exact child command', async () => {
    const adapter = factory(); await adapter.setup(); const result = await adapter.run()
    expect(result.races.schedules).toHaveLength(DRAFT_GET_CAPS.schedules)
    expect(result.fixtureUnchanged).toBe(true)
    expect(children.every(c => c.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
    expect(terminations).toHaveLength(children.length)
    expect(mocks.inventory.mock.calls.length).toBeGreaterThan(children.length)
    for (const args of mocks.spawn.mock.calls.map(call => call[1] as string[])) {
      expect(args).toContain(resources[0].id); expect(args).toContain('-XqAt'); expect(args).not.toContain('-h')
    }
  }, 15000)
  it('terminates the exact remote backend and reaps the child after a timed-out action', async () => {
    vi.useFakeTimers(); hangingSetup = true
    const adapter = factory(); const pending = adapter.setup(); const assertion = expect(pending).rejects.toThrow('exact project disposal required')
    await vi.advanceTimersByTimeAsync(90000); await assertion
    expect(terminations).toHaveLength(1)
    expect(terminations[0]).toContain('owned_pid=1000'); expect(terminations[0]).toContain('owned_started=2026-10-05T00:00:00+00:00')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    expect(adapter.diagnostic()).toContain('\"kind\":\"action-timeout\"')
    expect(adapter.diagnostic()).toContain('\"stage\":\"setup\"')
  })
  it('closes both exact sessions when a contender exits unexpectedly', async () => {
    const adapter = factory(); await adapter.setup(); failContender = true
    await expect(adapter.run()).rejects.toThrow()
    expect(children.slice(-2).every(child => child.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
    expect(terminations.length).toBe(children.length)
    expect(adapter.diagnostic()).toContain('\"schedule\":\"contextual_create\"')
    expect(adapter.diagnostic()).toContain('\"kind\":\"child-exit\"')
  })
  it('fails cleanup when remote termination cannot be confirmed, even after local children close', async () => {
    terminationConfirmed = false
    await expect(factory().setup()).rejects.toThrow('exact project disposal required')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
  })
  it('rejects a replaced captured container before opening any session', async () => {
    mocks.inventory.mockResolvedValue(resources.map(r => r.kind === 'container' && r.name === `supabase_db_${project}` ? { ...r, id: 'f'.repeat(64) } : r))
    await expect(factory().setup()).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('uses only the captured local Unix Docker endpoint for SQL and session commands', async () => {
    await factory().setup()
    for (const call of mocks.spawn.mock.calls) expect(call[1].slice(0, 2)).toEqual(['--host', 'unix:///private/tmp/pika-test-native-docker.sock'])
    for (const call of mocks.execFile.mock.calls.filter(call => call[0] === 'docker' && call[1].includes('exec')))
      expect(call[1].slice(0, 2)).toEqual(['--host', 'unix:///private/tmp/pika-test-native-docker.sock'])
  })
  it('rejects unaccepted native manifest bytes before native operations', () => {
    expect(() => createDraftGetNativeContracts({ repository, reviewedHead: head, original, capturedResources: resources,
      containerId: resources[0].id, acceptedManifestSha256: '0'.repeat(64) })).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.execFile).not.toHaveBeenCalled()
  })
  it('revokes only the exact snapshot grant for one probe and restores the full catalog and fixture', async () => {
    const adapter = factory(); await adapter.setup()
    const callback = vi.fn(async () => { expect(serviceExecute).toBe(false); return { status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const } })
    expect(await adapter.probeSnapshotPrivilegeDrift(callback)).toMatchObject({ privilegeRestored: true, fixtureUnchanged: true })
    expect(callback).toHaveBeenCalledTimes(1); expect(serviceExecute).toBe(true)
    await expect(adapter.probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).toHaveBeenCalledTimes(1)
  })
  it('uses the approved contract-session name for the restoration whole-row snapshot without weakening its guard', async () => {
    const adapter = factory(); await adapter.setup()
    await adapter.probeSnapshotPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    const snapshots = sqlControls.filter(command => command.sql === manifest.snapshot)
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].args).toContain(`PGAPPNAME=${project}_draft_contracts`)
    expect(manifest.snapshot).toContain(`'${project}_draft_contracts'`)
    expect(manifest.snapshot).not.toContain(`'${project}_fixture'`)
  })
  it('restores grants and proves fixture/catalog equality even when the SDK callback throws', async () => {
    const adapter = factory(); await adapter.setup()
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => { throw Error('private SDK failure') })).rejects.toThrow('exact project disposal required')
    expect(serviceExecute).toBe(true)
    expect(mocks.execFile.mock.calls.some(call => call[0] === 'docker' && call[1].includes('exec'))).toBe(true)
    await expect(adapter.run()).rejects.toThrow()
  })
  it('rejects fixture mutation during the probe after restoring the exact grant', async () => {
    const adapter = factory(); await adapter.setup()
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => { fixtureChanged = true; return { status: 503, rpcCalls: 1, rawCode: '42501' } })).rejects.toThrow()
    expect(serviceExecute).toBe(true)
  })
  it('rejects a changed function definition during restoration', async () => {
    const adapter = factory(); await adapter.setup()
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => { catalogChanged = true; return { status: 503, rpcCalls: 1, rawCode: '42501' } })).rejects.toThrow()
    expect(serviceExecute).toBe(true)
  })
  it('rejects an unexpected original ACL without revoking or running the SDK callback', async () => {
    const adapter = factory(); await adapter.setup(); serviceExecute = false
    const callback = vi.fn(async () => ({ status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }))
    await expect(adapter.probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled(); expect(serviceExecute).toBe(false)
  })
  it('rejects nonmatching SDK evidence and still restores the grant', async () => {
    const adapter = factory(); await adapter.setup()
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => ({ status: 403, rpcCalls: 1, rawCode: '42501' }) as never)).rejects.toThrow()
    expect(serviceExecute).toBe(true)
  })
  it('fails closed when grant restoration fails and forbids subsequent normal work', async () => {
    const adapter = factory(); await adapter.setup(); restorationFails = true
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))).rejects.toThrow('exact project disposal required')
    expect(serviceExecute).toBe(false)
    await expect(adapter.run()).rejects.toThrow()
  })
  it('rejects a PUBLIC ACL before revoking the expected service grant', async () => {
    const adapter = factory(); await adapter.setup(); publicGrant = true
    const callback = vi.fn(async () => ({ status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }))
    await expect(adapter.probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled(); expect(serviceExecute).toBe(true)
  })

  it('retains the privilege callback failure separately from failed restoration, without private text', async () => {
    const adapter = factory(); await adapter.setup(); restorationFails = true
    await expect(adapter.probeSnapshotPrivilegeDrift(async () => { throw new Error('PRIVATE SQL key=secret') })).rejects.toThrow('exact project disposal required')
    const receipt = adapter.diagnostic()
    expect(receipt).toContain('"stage":"privilege-probe"')
    expect(receipt).toContain('"kind":"unknown"')
    expect(receipt).toContain('"cleanup":"failed"')
    expect(receipt).toContain('"cleanupKind":"restoration"')
    expect(receipt).not.toMatch(/PRIVATE|SQL|key|secret|private grant|pika_assignment_list|postgres/)
  })
  it('labels heavy bounds child exit and preserves its numeric exit through cleanup', async () => {
    const adapter = factory(); await adapter.setup(); failBounds = true
    await expect(adapter.run()).rejects.toThrow('exact project disposal required')
    expect(adapter.diagnostic()).toContain('"stage":"bounds-drift"')
    expect(adapter.diagnostic()).toContain('"kind":"child-exit"')
    expect(adapter.diagnostic()).toContain('"exitCode":7')
    expect(children.every(child => child.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
  })
  it('never emits malformed private child frame content', async () => {
    privateFrame = true
    const adapter = factory()
    await expect(adapter.setup()).rejects.toThrow('exact project disposal required')
    expect(adapter.diagnostic()).toContain('"kind":"frame-decode"')
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|SQL|password|do-not-export|__draft_get_end_/)
  })

  it('reports a bounded control timeout without retaining the private child error', async () => {
    const originalCommand = mocks.execFile.getMockImplementation()!
    mocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: (error: unknown, stdout: string) => void) =>
      originalCommand(file, args, options, (_error: unknown, stdout: string) => callback(Object.assign(new Error('PRIVATE command SQL token=secret'), { killed: true, code: 99 }), stdout)))
    const adapter = factory()
    await expect(adapter.setup()).rejects.toThrow('exact project disposal required')
    expect(adapter.diagnostic()).toContain('"kind":"control-timeout"')
    expect(adapter.diagnostic()).toContain('"exitCode":99')
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|SQL|token|secret/)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it.each([true, false])('records a decoded snapshot semantic failure before finally cleanup, terminationConfirmed=%s', async confirmed => {
    const adapter = factory(); await adapter.setup(); wrongSnapshotActor = true; failWrongActorTermination = !confirmed
    await expect(adapter.run()).rejects.toThrow()
    const receipt = adapter.diagnostic()
    expect(receipt).toContain('"stage":"concurrency"')
    expect(receipt).toContain('"schedule":"contextual_create"')
    expect(receipt).toContain('"phase":"verify"')
    expect(receipt).toContain('"kind":"assertion"')
    expect(receipt).toContain(confirmed ? '"cleanup":"complete"' : '"cleanup":"failed"')
    expect(receipt).toContain(confirmed ? '"cleanupKind":"none"' : '"cleanupKind":"termination"')
    expect(receipt).not.toMatch(/PRIVATE|snapshot actor|token|secret|postgres|pika_assignment_list/)
    expect(receipt).not.toContain(manifest.fixture.outsider)
    expect(children.slice(-2).every(child => child.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
  })
  it.each(['stdout', 'stderr'])('recognizes the fixed Node maxBuffer code with truncated %s, without exposing output', async stream => {
    const originalCommand = mocks.execFile.getMockImplementation()!
    mocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: (error: unknown, stdout: string) => void) =>
      originalCommand(file, args, options, () => callback(Object.assign(new Error(`PRIVATE ${stream} token=secret`), { killed: true, code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), stream === 'stdout' ? 'x'.repeat(manifest.capabilities.outputBytes) : 'PRIVATE bounded stdout')))
    const adapter = factory()
    await expect(adapter.setup()).rejects.toThrow('exact project disposal required')
    expect(adapter.diagnostic()).toContain('"kind":"output-limit"')
    expect(adapter.diagnostic()).toContain('"exitCode":-1')
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|stdout|stderr|MAXBUFFER|token|secret/)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('labels the next schedule before its initial verification instead of retaining the completed schedule', async () => {
    const adapter = factory(); await adapter.setup()
    mocks.inventory.mockImplementation(async () => {
      const raceChildren = children.filter((_child, index) => mocks.spawn.mock.calls[index][1].some((arg: string) => /^PGAPPNAME=.*_draft_(holder|contender)$/.test(arg)))
      if (raceChildren.length === 2 && raceChildren.every(child => child.kill.mock.calls.length > 0)) throw new Error('PRIVATE next-boundary token=secret')
      return resources
    })
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('"schedule":"contextual_repair"')
    expect(adapter.diagnostic()).not.toContain('"schedule":"contextual_create"')
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|boundary|token|secret/)
  })
  it('clears schedule context before the post-concurrency whole-row assertion', async () => {
    const adapter = factory(); await adapter.setup(); finalSnapshotChanged = true
    await expect(adapter.run()).rejects.toThrow('Rollback schedule whole-row equality differs')
    expect(holderCount()).toBe(DRAFT_GET_CAPS.schedules)
    expect(adapter.diagnostic()).toContain('"stage":"concurrency"')
    expect(adapter.diagnostic()).toContain('"schedule":"none"')
    expect(adapter.diagnostic()).toContain('"kind":"assertion"')
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|changed rows|token|secret|purge_fence/)
  }, 15000)

  it.each(['contracts', 'concurrency'] as const)('keeps %s semantic rejection and cleanup intact even when an observer throws', async kind => {
    const bound = Object.freeze({ projectId: project, apiUrl: 'http://127.0.0.1:54331', databaseHost: '127.0.0.1', databasePort: 54332,
      containerId: resources[0].id, containerProjectLabel: project, disposable: true as const, reviewedHead: head,
      migrationManifestSha256: manifest.migrationManifestSha256, reviewedSourceSha256: manifest.sourceSha256,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(kind === 'contracts' ? manifest.contracts : manifest.concurrency)) })
    const closed: string[] = []
    const observe = vi.fn((_event: Parameters<NonNullable<DraftGetDriver['observe']>>[0]) => { throw new Error('PRIVATE observer token=secret') })
    const driver: DraftGetDriver = { observe, verifyTarget: async () => bound, openSession: async name => ({
      name: kind === 'contracts' ? 'PRIVATE wrong session' : name,
      execute: async () => [{ result: { version: 1, actor_id: 'PRIVATE wrong actor' } }],
      rollbackAndClose: async () => { closed.push(name) },
    }) }
    const runner = kind === 'contracts' ? runDraftGetContracts : runDraftGetConcurrency
    await expect(runner(manifest.fixture, bound, repository, driver)).rejects.toBeInstanceOf(AssertionError)
    expect(closed).toHaveLength(kind === 'contracts' ? 1 : 2)
    expect(observe.mock.calls.some(([event]) => event.event === 'failure' && event.kind === 'assertion')).toBe(true)
    expect(JSON.stringify(observe.mock.calls)).not.toMatch(/PRIVATE|wrong|token|secret/)
  })
  it('forbids a probe before exact fixture setup', async () => {
    const callback = vi.fn(async () => ({ status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }))
    await expect(factory().probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled()
  })
})


describe('finite native failure diagnostic receipt', () => {
  it('bounds metadata, rejects arbitrary enums and preserves the first failure through cleanup', () => {
    let now = 0
    const diagnostic = createDraftGetNativeDiagnostic(() => now)
    diagnostic.stage('bounds-drift'); diagnostic.phase('sql'); diagnostic.schedule('PRIVATE UUID password=secret')
    now = Number.MAX_SAFE_INTEGER
    diagnostic.fail('child-exit', Number.MAX_SAFE_INTEGER)
    diagnostic.stage('privilege-restoration'); diagnostic.phase('PRIVATE stderr'); diagnostic.fail('PRIVATE error message')
    diagnostic.cleanupStart(); diagnostic.cleanupEnd('PRIVATE SQL'); diagnostic.cleanupEnd()
    expect(diagnostic.receipt()).toEqual({ stage: 'bounds-drift', phase: 'sql', schedule: 'none', elapsedMs: 945000,
      kind: 'child-exit', exitCode: -1, cleanup: 'failed', cleanupKind: 'unknown' })
    expect(diagnostic.format()).not.toMatch(/PRIVATE|UUID|password|secret|stderr|SQL|message/)
    expect(Object.isFrozen(diagnostic.receipt())).toBe(true)
  })
  it('handles invalid/backward clocks without nonfinite or negative exported numbers', () => {
    let now = 100
    const diagnostic = createDraftGetNativeDiagnostic(() => now)
    now = -100; expect(diagnostic.receipt().elapsedMs).toBe(0)
    now = NaN; diagnostic.fail('unknown', NaN)
    expect(diagnostic.receipt().elapsedMs).toBe(0); expect(diagnostic.receipt().exitCode).toBe(-1)
    expect(diagnostic.format()).not.toMatch(/NaN|Infinity/)
  })
})
