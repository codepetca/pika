import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { readdirSync } from 'node:fs'
import { PassThrough, Writable } from 'node:stream'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), execFile: vi.fn(), inventory: vi.fn(),
  snapshotSqlReads: false, sourceDrift: false, driftMigration: '249_contextual_test_draft_owner_save.sql', socketInode: 2, sqlFileCache: new Map<string, string>() }))
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
        return mocks.sourceDrift && path.endsWith(`/${mocks.driftMigration}`)
          ? `${source}\n-- offline source drift` : source
      }
      return actual.readFileSync(path, options)
    }) as typeof actual.readFileSync,
    statSync: (path: string) => path === '/private/tmp/pika-test-native-docker.sock' ? { isSocket: () => true, dev: 1, ino: mocks.socketInode, mode: 3, rdev: 4 } : actual.statSync(path) }
})
vi.mock('../../scripts/contextual-test-draft-save-proof-inventory', () => ({ draftSaveProofDockerInventory: mocks.inventory }))
import { buildDraftSaveNativeContractsManifest, createDraftSaveNativeContracts, validateDraftSaveNativeSql, draftSaveNativeTerminationSql,
  buildTestOwnerCreateNativeContractsManifest, validateTestOwnerCreateNativeSql, createTestOwnerCreateNativeContracts,
  validateTestOwnerCreateAllocatorPlan } from '../../scripts/contextual-test-draft-save-native-contracts'
import { contextualTestCreateTestSchema, contextualTestCreateDraftSchema } from '../../src/lib/validations/contextual-test-create'
import { newTestOwnerCreateFixture } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { DRAFT_SAVE_CAPS } from '../../scripts/check-contextual-test-draft-save-db-contracts'
import { assignmentListExpectedResources } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'

describe('inert native Test draft save contracts', () => {
  const original = newAssignmentListProofFixture()
  const repository = process.cwd()
  const head = '7570a9d60591183f0699001f47a6528045a392ee'
  it('performs no native operation when imported or preparing its finite manifest', () => {
    const manifest = buildDraftSaveNativeContractsManifest(original, head, repository)
    expect(manifest.concurrency.schedules).toHaveLength(DRAFT_SAVE_CAPS.schedules)
    expect(manifest.fixture.allowedFixtureIds).toHaveLength(10017)
    expect(manifest.setup).toContain('commit;')
    expect(manifest.termination).toBe(draftSaveNativeTerminationSql())
    expect(Object.isFrozen(manifest.concurrency.schedules)).toBe(true)
    expect(Object.isFrozen(manifest.concurrency.schedules[0])).toBe(true)
    expect(() => { (manifest.concurrency.schedules[0] as { holderSql: string }).holderSql = 'delete from public.users;' }).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled(); expect(mocks.execFile).not.toHaveBeenCalled(); expect(mocks.inventory).not.toHaveBeenCalled()
  })
  it('accepts only exact manifest SQL and a lowercase opaque source SHA substitution', () => {
    const manifest = buildDraftSaveNativeContractsManifest(original, head, repository)
    const template = manifest.concurrency.schedules[0].finalTemplate
    expect(validateDraftSaveNativeSql(manifest, template.replace('0'.repeat(64), 'a'.repeat(64)))).toBe(true)
    expect(validateDraftSaveNativeSql(manifest, template.replace('0'.repeat(64), 'A'.repeat(64)))).toBe(false)
    expect(validateDraftSaveNativeSql(manifest, 'delete from public.users;')).toBe(false)
    expect(validateDraftSaveNativeSql(manifest, `${template} select 1;`)).toBe(false)
  })
  it('rejects arbitrary head identities before opening anything', () => {
    expect(() => buildDraftSaveNativeContractsManifest(original, 'main', repository)).toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('binds remote termination to captured pid/start, reserved name, database and user', () => {
    const sql = draftSaveNativeTerminationSql()
    expect(sql).toContain("pid=:'owned_pid'::integer")
    expect(sql).toContain("backend_start=:'owned_started'::timestamptz")
    expect(sql).toContain("application_name=:'owned_name'")
    expect(sql).toContain("datname='postgres'"); expect(sql).toContain("usename='postgres'")
    expect(sql).toContain('pg_terminate_backend(pid,5000)')
  })
})

describe('closed migration250 native profile', () => {
  const original = newAssignmentListProofFixture()
  const f = newTestOwnerCreateFixture(original)
  const repository = process.cwd()
  const head = '7570a9d60591183f0699001f47a6528045a392ee'
  it('prepares no second durable fixture and selects only the reviewed250 capability', () => {
    const manifest = buildTestOwnerCreateNativeContractsManifest(original, f, head, repository)
    expect(manifest.fixture).toEqual(f)
    expect(manifest.setup).not.toMatch(/\b(?:insert|update|delete|commit)\b/i)
    expect(manifest.setup).toContain('Migration250 fixture presence differs')
    expect(manifest.privilege.revoke).toContain('create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)')
    expect(manifest.privilege.revoke).not.toContain('snapshot_test_draft_save_for_owner_v1')
    expect(manifest.capabilities).toEqual(buildDraftSaveNativeContractsManifest(original, head, repository).capabilities)
    expect(manifest.concurrency.schedules).toHaveLength(9)
    expect(Object.isFrozen(manifest.fixture)).toBe(true)
  })
  it('accepts only literal fixed250 SQL with no opaque substitution or caller profile', () => {
    const manifest = buildTestOwnerCreateNativeContractsManifest(original, f, head, repository)
    for (const sql of [manifest.setup, manifest.snapshot, manifest.contracts.contracts, manifest.contracts.catalogAndPlan,
      ...manifest.concurrency.schedules.flatMap(s => [s.holderSql, ...(s.holderWitnessSql ?? []), s.rejectSql, s.observeSql])]) {
      expect(validateTestOwnerCreateNativeSql(manifest, sql)).toBe(true)
      expect(validateTestOwnerCreateNativeSql(manifest, `${sql} select 1;`)).toBe(false)
    }
    expect(validateTestOwnerCreateNativeSql(manifest, 'delete from public.users;')).toBe(false)
    expect(validateTestOwnerCreateNativeSql(manifest, manifest.privilege.restore)).toBe(false)
    expect(validateTestOwnerCreateNativeSql(manifest, buildDraftSaveNativeContractsManifest(original, head, repository).setup)).toBe(false)
    expect(() => buildTestOwnerCreateNativeContractsManifest(original, { ...f, tests: [] }, head, repository)).toThrow()
    expect(typeof createTestOwnerCreateNativeContracts).toBe('function')
  })
  it('rejects index DDL as a substitute for the actual bounded allocator plan', () => {
    const scan = { 'Node Type': 'Index Only Scan', 'Parent Relationship': 'Outer', 'Parallel Aware': false, 'Async Capable': false,
      'Scan Direction': 'Forward', 'Index Name': 'idx_tests_classroom_position_owner_create', 'Relation Name': 'tests', Alias: 'test',
      'Index Cond': `(classroom_id = '${f.classes[3].id}'::uuid)` }
    const catalog = { function: 'a'.repeat(32), index: 'CREATE INDEX idx_tests_classroom_position_owner_create ON public.tests USING btree (classroom_id, position DESC, id DESC)',
      test_columns: Object.keys(contextualTestCreateTestSchema.shape), draft_columns: Object.keys(contextualTestCreateDraftSchema.shape),
      plan: [{ Plan: { 'Node Type': 'Limit', 'Parallel Aware': false, 'Async Capable': false, Plans: [scan] } }] }
    expect(validateTestOwnerCreateAllocatorPlan(catalog, f)).toBe(true)
    expect(validateTestOwnerCreateAllocatorPlan({ ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, 'Node Type': 'Index Scan' }] } }] }, f)).toBe(true)
    for (const bad of [null, { ...catalog, plan: [] }, { ...catalog, plan: [{ Plan: { 'Node Type': 'Seq Scan', 'Relation Name': 'tests' } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, 'Index Name': 'different_index' }] } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, 'Index Cond': `(classroom_id = '${f.classes[0].id}'::uuid)` }] } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, 'Scan Direction': 'Backward' }] } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [scan, scan] } }] },
      { ...catalog, plan: [{ Plan: { ...catalog.plan[0].Plan, Plans: [{ ...scan, Filter: 'true' }] } }] },
      { ...catalog, test_columns: catalog.test_columns.slice(1) }, { ...catalog, unrelated: true }])
      expect(() => validateTestOwnerCreateAllocatorPlan(bad, f)).toThrow()
  })
})

describe('native persistent-session transport with offline child mocks', () => {
  const original = newAssignmentListProofFixture()
  const head = '7570a9d60591183f0699001f47a6528045a392ee'
  const repository = process.cwd()
  const manifest = buildDraftSaveNativeContractsManifest(original, head, repository)
  const project = manifest.fixture.projectId
  const resources = assignmentListExpectedResources(project).map((r, index) => ({ ...r, id: (index + 1).toString(16).padStart(64, '0'), createdAt: '2026-10-05T00:00:00Z',
    labels: { 'com.supabase.cli.project': project, 'com.docker.compose.project': project }, attachedIds: [], ports: r.name.startsWith('supabase_db_') && r.kind === 'container' ? [54332] : [] }))
  const children: Array<EventEmitter & { stdin: Writable; stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }> = []
  const terminations: string[][] = []
  const sqlControls: Array<{ args: string[]; sql: string }> = []
  let hangingSetup = false; let failContender = false; let terminationConfirmed = true
  let setupExit = false; let malformedSetup = false; let stderrChunks: string[] = []
  let createManifest: ReturnType<typeof buildTestOwnerCreateNativeContractsManifest> | undefined
  let serviceExecute = true; let fixtureChanged = false; let catalogChanged = false; let restorationFails = false; let publicGrant = false
  const catalog = () => ({ owner: 'postgres', definition: catalogChanged ? 'changed function' : 'reviewed function',
    acl: [{ grantor: 'postgres', grantee: 'postgres', privilege_type: 'EXECUTE', is_grantable: false },
      ...(serviceExecute ? [{ grantor: 'postgres', grantee: 'service_role', privilege_type: 'EXECUTE', is_grantable: false }] : []),
      ...(publicGrant ? [{ grantor: 'postgres', grantee: 'PUBLIC', privilege_type: 'EXECUTE', is_grantable: false }] : [])] })
  const factory = () => createDraftSaveNativeContracts({ repository, reviewedHead: head, original, capturedResources: resources,
    containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id, acceptedManifestSha256: testOwnerDigest(JSON.stringify(manifest)) })
  const createFactory = () => {
    createManifest = buildTestOwnerCreateNativeContractsManifest(original, newTestOwnerCreateFixture(original), head, repository)
    return createTestOwnerCreateNativeContracts({ repository, reviewedHead: head, original, fixture: createManifest.fixture,
      capturedResources: resources, containerId: resources.find(r => r.name === `supabase_db_${project}`)!.id,
      acceptedManifestSha256: testOwnerDigest(JSON.stringify(createManifest)) })
  }
  beforeEach(() => {
    mocks.snapshotSqlReads = true; mocks.sourceDrift = false; mocks.sqlFileCache.clear()
    vi.clearAllMocks(); children.length = 0; terminations.length = 0; sqlControls.length = 0; hangingSetup = false; failContender = false; terminationConfirmed = true
    serviceExecute = true; fixtureChanged = false; catalogChanged = false; restorationFails = false; publicGrant = false
    setupExit = false; malformedSetup = false; stderrChunks = []; createManifest = undefined
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
          else if (input === manifest.privilege.restore || input === createManifest?.privilege.restore) {
            if (restorationFails) callback(Error('private grant restore failure'), '')
            else { serviceExecute = true; callback(null, '') }
          }
          else if (input === manifest.privilege.catalog || input === createManifest?.privilege.catalog) callback(null, JSON.stringify(catalog()))
          else if (input === manifest.snapshot || input === createManifest?.snapshot) callback(null, JSON.stringify({ wholeRows: fixtureChanged ? 'changed' : 'unchanged' }))
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
        const text = String(chunk); const end = text.match(/\\echo (__draft_save_end_[0-9]+__)/)![1]
        const sql = text.slice(0, text.indexOf('\n\\echo'))
        let response = ''
        if (sql === manifest.bootstrap) response = JSON.stringify({ pid, started: '2026-10-05T00:00:00+00:00', name, database: 'postgres', user: 'postgres' })
        else if (sql === manifest.setup && hangingSetup) { done(); return }
        else if ((sql === manifest.setup || sql === createManifest?.setup) && setupExit) {
          for (const chunk of stderrChunks) child.stderr.write(chunk)
          queueMicrotask(() => child.emit('close', 1)); done(); return
        }
        else if (sql === manifest.setup && malformedSetup) response = 'PRIVATE malformed row'
        else if (sql === manifest.concurrency.observe) response = JSON.stringify({ held:true,transaction:true })
        else if (sql === manifest.snapshot || sql === createManifest?.snapshot) response = JSON.stringify({ wholeRows: fixtureChanged ? 'changed' : 'unchanged' })
        else if (sql === manifest.privilege.catalog || sql === createManifest?.privilege.catalog) response = JSON.stringify(catalog())
        else if (sql === manifest.privilege.revoke || sql === createManifest?.privilege.revoke) serviceExecute = false
        else if (sql.includes('select public.snapshot_test_draft_save_for_owner_v1')) {
          const testId = sql.match(/_v1\('[a-f0-9-]+','([a-f0-9-]+)'/)![1]
          response = JSON.stringify({ version: 1, actor_id: manifest.fixture.owner, classroom: { id: manifest.fixture.classroom, teacher_id: manifest.fixture.owner },
            test: { id: testId, classroom_id: manifest.fixture.classroom }, source_sha256: 'a'.repeat(64) })
        } else if (sql.startsWith('select public.finish_test_draft_save_for_owner_v1')) {
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
  afterEach(() => { vi.useRealTimers(); mocks.snapshotSqlReads = false; mocks.sourceDrift = false;
    mocks.driftMigration = '249_contextual_test_draft_owner_save.sql'; mocks.socketInode = 2; mocks.sqlFileCache.clear() })
  function holdInitialGuard() {
    const implementation = mocks.execFile.getMockImplementation()!
    let holding = true
    const jobs: { args: string[]; settle: (error?: Error, output?: string) => void }[] = []
    mocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: (error: unknown, stdout: string) => void) =>
      implementation(file, args, options, (error: unknown, stdout: string) => {
        if (holding && (file === 'git' || args[0] === 'context')) {
          let settled = false
          jobs.push({ args, settle: (replacementError, output) => {
            if (!settled) { settled = true; callback(replacementError ?? error, output ?? stdout) }
          } })
        }
        else callback(error, stdout)
      }))
    return { jobs, release() { holding = false; for (const job of jobs) job.settle() } }
  }
  async function flushGuardReads() { for (let i = 0; i < 12; i++) await Promise.resolve() }
  it('exposes only a read-only target verifier without opening a persistent SQL session', async () => {
    const adapter = factory()
    const target = await adapter.verifyTarget()
    expect(target.reviewedHead).toBe(head)
    expect(target.reviewedSourceSha256).toBe(manifest.sourceSha256)
    expect(target.acceptedManifestSha256).toBe(testOwnerDigest(JSON.stringify(manifest)))
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(sqlControls.some(control => control.sql === manifest.setup)).toBe(false)
    expect(Object.keys(adapter)).not.toContain('execute')
  })
  it('restores the actual250 CREATE grant and full catalog even if its SDK probe rejects', async () => {
    const adapter = createFactory(); await adapter.setup()
    expect(Object.keys(adapter)).not.toContain('probeSnapshotPrivilegeDrift')
    await expect(adapter.probeCreatePrivilegeDrift(async () => { throw new Error('PRIVATE SDK rejection') })).rejects.toThrow()
    expect(serviceExecute).toBe(true)
    const restores = sqlControls.filter(c => c.sql === createManifest!.privilege.restore)
    expect(restores).toHaveLength(1)
    expect(restores[0].sql).toContain('create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)')
    expect(adapter.diagnostic()).toContain('DIAG test-owner-create native phase=privilege')
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
  })
  it('reports a CREATE ACL receipt with no snapshot capability naming', async () => {
    const adapter = createFactory(); await adapter.setup()
    const receipt = await adapter.probeCreatePrivilegeDrift(async () => ({ status: 503, rpcCalls: 1, rawCode: '42501' }))
    expect(receipt).toEqual({ privilegeRestored: true, fixtureUnchanged: true, createAclSha256: expect.stringMatching(/^[a-f0-9]{64}$/) })
    expect(serviceExecute).toBe(true)
  })
  it('rejects changed250 bytes before SDK guard or native work dispatch', async () => {
    const adapter = createFactory(); await adapter.setup()
    const childrenBefore = children.length, sqlBefore = sqlControls.length
    mocks.driftMigration = '250_contextual_test_owner_create.sql'; mocks.sourceDrift = true
    await expect(adapter.verifyTarget()).rejects.toThrow()
    expect(children).toHaveLength(childrenBefore)
    expect(sqlControls.slice(sqlBefore).every(c => !c.args.includes('exec'))).toBe(true)
  })
  it('reports a closed guard failure and preserves it across subsequent work', async () => {
    const adapter = factory()
    mocks.inventory.mockRejectedValueOnce(Error('PRIVATE inventory failure'))
    await expect(adapter.setup()).rejects.toThrow()
    const diagnostic = adapter.diagnostic()
    expect(diagnostic).toMatch(/^DIAG test-owner-draft-save native phase=setup failure=guard role=fixture sqlstate=unknown controls=\d{1,4} actions=\d{1,3} sessions=\d\.\n$/)
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toBe(diagnostic)
    expect(diagnostic).not.toContain('PRIVATE')
  })
  it('captures only the closed SQLSTATE of a failed private SQL guard', async () => {
    const adapter = factory()
    const implementation = mocks.execFile.getMockImplementation()!
    mocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: (error: unknown, stdout: string, stderr?: string) => void) =>
      implementation(file, args, options, (error: unknown, stdout: string) => {
        if (args.includes('exec')) callback(Error('PRIVATE guard message'), '', 'PRIVATE secret\nERROR:  42501\n')
        else callback(error, stdout)
      }))
    await expect(adapter.setup()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('phase=setup failure=guard role=fixture sqlstate=42501')
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it.each([
    [['PRIVATE secret\nERR', 'OR:  57', '014\n'], '57014'],
    [['FAT', 'AL: PT409\nPRIVATE secret\n'], 'PT409'],
    [['ERROR: ZZ999\nPRIVATE secret\n'], 'unknown'],
    [['PRIVATE token ERROR: 42501 extra secret\n'], 'unknown'],
  ] as const)('reports only allowlisted SQLSTATE after split stderr and child exit %s', async (chunks, code) => {
    const adapter = factory(); setupExit = true; stderrChunks = [...chunks]
    await expect(adapter.setup()).rejects.toThrow('exact project disposal required')
    const diagnostic = adapter.diagnostic()
    expect(diagnostic).toContain('phase=setup failure=child-exit role=fixture')
    expect(diagnostic).toContain(`sqlstate=${code} `)
    expect(diagnostic).not.toContain('PRIVATE'); expect(diagnostic).not.toContain('secret')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    expect(terminations).toHaveLength(1)
  })
  it.each([['PC001', 'PC001'], ['PC999', 'unknown']])('reports only a finite CREATE proof failure code %s', async (code, expected) => {
    const adapter = createFactory(); setupExit = true; stderrChunks = [`PRIVATE secret\nERROR: ${code}\nPRIVATE row\n`]
    await expect(adapter.setup()).rejects.toThrow('exact project disposal required')
    expect(adapter.diagnostic()).toContain(`sqlstate=${expected} `)
    expect(adapter.diagnostic()).not.toMatch(/PRIVATE|secret|row/)
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    expect(terminations).toHaveLength(1)
  })
  it('reports protocol failure without the malformed private row or cleanup overwriting it', async () => {
    const adapter = factory(); malformedSetup = true; terminationConfirmed = false
    await expect(adapter.setup()).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('phase=setup failure=protocol role=fixture sqlstate=unknown')
    expect(adapter.diagnostic()).not.toContain('PRIVATE')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
  })
  it('retains the existing stderr cap and emits no raw stderr during rejection', async () => {
    const adapter = factory(); setupExit = true; stderrChunks = ['PRIVATE'.repeat(10000)]
    const write = vi.spyOn(process.stderr, 'write')
    try {
      await expect(adapter.setup()).rejects.toThrow()
      expect(adapter.diagnostic()).toContain('phase=setup failure=protocol role=fixture sqlstate=unknown')
      expect(write).not.toHaveBeenCalled()
      expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
    } finally { write.mockRestore() }
  })
  it('retains the native total cap and records only bounded budget counters', async () => {
    vi.useFakeTimers()
    const adapter = factory(); await adapter.setup()
    await vi.advanceTimersByTimeAsync(900000)
    await expect(adapter.run()).rejects.toThrow()
    expect(adapter.diagnostic()).toMatch(/phase=snapshot failure=timeout role=none sqlstate=unknown controls=\d{1,4} actions=\d{1,3} sessions=0\.\n$/)
    expect(children).toHaveLength(1)
  })
  it('overlaps the four fresh read checks and waits for all before inventory, SQL or sessions', async () => {
    const held = holdInitialGuard()
    const pending = factory().setup()
    const outcome = pending.catch(error => error)
    try {
      await flushGuardReads()
      expect(held.jobs.map(job => job.args.slice(0, 2))).toEqual([
        ['rev-parse', 'HEAD'], ['rev-parse', '--show-toplevel'], ['status', '--porcelain'], ['context', 'inspect'],
      ])
      held.jobs[0].settle(); held.jobs[1].settle(); held.jobs[2].settle()
      await flushGuardReads()
      expect(mocks.inventory).not.toHaveBeenCalled()
      expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
      expect(mocks.spawn).not.toHaveBeenCalled()
    } finally { held.release(); await outcome }
    await expect(pending).resolves.toHaveProperty('setupSha256')
  })
  it.each([
    ['failed HEAD child', 0, Error('offline read failed'), undefined],
    ['changed HEAD', 0, undefined, 'f'.repeat(40)],
    ['changed root', 1, undefined, '/private/tmp/other-repository'],
    ['dirty source', 2, undefined, ' M scripts/contextual-test-draft-save-native-contracts.ts'],
    ['remote endpoint', 3, undefined, JSON.stringify({ endpoints: { docker: { Host: 'tcp://127.0.0.1:2375' } }, tlsMaterial: null })],
  ] as const)('settles every independent read after %s before rejecting without dispatch', async (_label, index, error, output) => {
    const held = holdInitialGuard()
    let finished = false
    const adapter = factory(); const pending = adapter.setup()
    const outcome = pending.then(() => { finished = true }, () => { finished = true })
    try {
      await flushGuardReads()
      expect(held.jobs).toHaveLength(4)
      held.jobs[index].settle(error, output)
      await flushGuardReads()
      expect(finished).toBe(false)
      expect(mocks.inventory).not.toHaveBeenCalled()
      expect(mocks.spawn).not.toHaveBeenCalled()
      expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
    } finally { held.release(); await outcome }
    await expect(pending).rejects.toThrow()
    expect(adapter.diagnostic()).toContain('phase=setup failure=guard role=fixture sqlstate=unknown')
    expect(mocks.inventory).not.toHaveBeenCalled()
    expect(mocks.spawn).not.toHaveBeenCalled()
  })
  it('waits for complete inventory and rejects socket replacement before SQL or session dispatch', async () => {
    let releaseInventory!: (value: typeof resources) => void
    mocks.inventory.mockImplementationOnce(() => new Promise(resolve => { releaseInventory = resolve }))
    const pending = factory().setup()
    const outcome = pending.catch(error => error)
    await flushGuardReads()
    expect(mocks.inventory).toHaveBeenCalledTimes(1)
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
    mocks.socketInode = 99
    releaseInventory(resources)
    await outcome
    await expect(pending).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
    expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
  })
  it('waits for the post-inventory endpoint read before SQL or session dispatch', async () => {
    const implementation = mocks.execFile.getMockImplementation()!
    let releaseEndpoint: (() => void) | undefined
    let held = false
    mocks.execFile.mockImplementation((file: string, args: string[], options: unknown, callback: (error: unknown, stdout: string) => void) =>
      implementation(file, args, options, (error: unknown, stdout: string) => {
        if (!held && args[0] === 'context' && mocks.inventory.mock.calls.length) {
          held = true; releaseEndpoint = () => callback(error, stdout)
        } else callback(error, stdout)
      }))
    const pending = factory().setup()
    const outcome = pending.catch(error => error)
    try {
      await flushGuardReads()
      expect(releaseEndpoint).toBeTypeOf('function')
      expect(mocks.inventory).toHaveBeenCalledTimes(1)
      expect(mocks.spawn).not.toHaveBeenCalled()
      expect(sqlControls.every(control => !control.args.includes('exec'))).toBe(true)
    } finally { releaseEndpoint?.(); await outcome }
    await expect(pending).resolves.toHaveProperty('setupSha256')
  })
  it.each(['249_contextual_test_draft_owner_save.sql', '001_create_users.sql'])('snapshots the complete offline SQL fixture and rejects changed %s before work', async migration => {
    const adapter = factory(); await adapter.setup()
    expect(mocks.sqlFileCache.size).toBe(readdirSync('supabase/migrations').filter(name => name.endsWith('.sql')).length)
    const dispatchedSql = sqlControls.length
    const spawnedChildren = children.length
    const inventories = mocks.inventory.mock.calls.length
    mocks.driftMigration = migration; mocks.sourceDrift = true
    await expect(adapter.run()).rejects.toThrow('Expected values to be strictly equal')
    expect(sqlControls.slice(dispatchedSql).every(control => ['rev-parse', 'status', 'context'].includes(control.args[0]))).toBe(true)
    expect(mocks.inventory).toHaveBeenCalledTimes(inventories)
    expect(children).toHaveLength(spawnedChildren)
    expect(children.every(child => child.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
  })
  it('runs the finite protocol through persistent sessions and binds every exact child command', async () => {
    const adapter = factory(); await adapter.setup(); const result = await adapter.run()
    expect(result.races.schedules).toHaveLength(DRAFT_SAVE_CAPS.schedules)
    expect(result.fixtureUnchanged).toBe(true)
    expect(children.every(c => c.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
    expect(terminations).toHaveLength(children.length)
    expect(mocks.inventory.mock.calls.length).toBeGreaterThan(children.length)
    for (const args of mocks.spawn.mock.calls.map(call => call[1] as string[])) {
      expect(args).toContain(resources[0].id); expect(args).toContain('-XqAt'); expect(args).not.toContain('-h')
    }
  },15000)
  it('terminates the exact remote backend and reaps the child after a timed-out action', async () => {
    vi.useFakeTimers(); hangingSetup = true
    const adapter = factory(); const pending = adapter.setup(); const assertion = expect(pending).rejects.toThrow('exact project disposal required')
    await vi.advanceTimersByTimeAsync(90000); await assertion
    expect(adapter.diagnostic()).toContain('phase=setup failure=timeout role=fixture sqlstate=unknown')
    expect(terminations).toHaveLength(1)
    expect(terminations[0]).toContain('owned_pid=1000'); expect(terminations[0]).toContain('owned_started=2026-10-05T00:00:00+00:00')
    expect(children[0].kill).toHaveBeenCalledWith('SIGKILL')
  })
  it('closes both exact sessions when a contender exits unexpectedly', async () => {
    const adapter = factory(); await adapter.setup(); failContender = true
    await expect(adapter.run()).rejects.toThrow()
    expect(children.slice(-2).every(child => child.kill.mock.calls.some(([signal]) => signal === 'SIGKILL'))).toBe(true)
    expect(terminations.length).toBe(children.length)
    expect(adapter.diagnostic()).toContain('phase=races failure=child-exit role=contender sqlstate=unknown')
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
    expect(() => createDraftSaveNativeContracts({ repository, reviewedHead: head, original, capturedResources: resources,
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
  it('forbids a probe before exact fixture setup', async () => {
    const callback = vi.fn(async () => ({ status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }))
    await expect(factory().probeSnapshotPrivilegeDrift(callback)).rejects.toThrow()
    expect(callback).not.toHaveBeenCalled(); expect(mocks.spawn).not.toHaveBeenCalled()
  })
})
