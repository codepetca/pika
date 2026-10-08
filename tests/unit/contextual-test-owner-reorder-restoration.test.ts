import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssignmentListLifecycleAdapters } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import { TEST_OWNER_REORDER_SNAPSHOT_TABLES } from '../../scripts/contextual-test-reorder-proof-fixture'

// Real adopter + parent + installed-SDK revocation observer. Only external
// platform primitives and unrelated reorder setup/matrix evidence are stubbed.
// No process, socket, database, CLI, network or native proof is executed here.
describe.sequential('reorder adopter preserves exact parent restoration', () => {
  afterEach(() => {
    vi.restoreAllMocks(); vi.resetModules()
    for (const name of ['node:child_process', 'node:fs', '../../scripts/contextual-assignment-list-proof-platform',
      '../../scripts/contextual-assignment-list-proof-lifecycle', '../../scripts/contextual-test-reorder-proof-fixture',
      '../../scripts/contextual-test-reorder-proof-transport', '../../scripts/contextual-test-draft-save-native-contracts',
      '../../scripts/contextual-test-draft-save-proof-inventory']) vi.doUnmock(name)
  })
  async function run(expiry: 'pending-fulfilled' | 'pending-rejected' | 'restore-session' | 'restore-sql',
    drift?: string, verificationFails = false, corruption?: string) {
    vi.resetModules()
    let clock = Date.parse('2026-10-08T19:40:00Z'), project = '', running = false, exists = false
    let active = false, revoked = false, restores = 0, verifications = 0
    let adapters: AssignmentListLifecycleAdapters
    let failure: import('../../scripts/contextual-assignment-list-proof-lifecycle').AssignmentListLifecycleError | undefined
    let resources: import('../../scripts/contextual-assignment-list-proof-lifecycle').AssignmentListResource[] = []
    const events: string[] = [], canonicalRequests: unknown[] = [], fieldReads: string[] = []
    const names = [...TEST_OWNER_REORDER_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets', 'public.future_unrelated_table'].sort()
    const canonical = { rowDigests: JSON.stringify(Object.fromEntries(names.map(n => [n, { count: 0, digest: 'a'.repeat(32) }]))),
      guard168Metadata: '{}', settings: '{}', cronJobs: '[]', resources: '[]' }
    const graph = { ...Object.fromEntries(TEST_OWNER_REORDER_SNAPSHOT_TABLES.map(t => [t, []])), __bulk_tests: [], __bulk_setup: [],
      __nontarget_fingerprints: names.map(table => ({ table, fingerprint: 'unchanged' })) }
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.doMock('node:child_process', async () => ({ ...await vi.importActual<typeof import('node:child_process')>('node:child_process'),
      execFileSync: (file: string, args: string[], options: { input?: string }) => {
        if (file === 'git') return args[0] === 'rev-parse' ? args[1] === 'HEAD' ? 'a'.repeat(40) : process.cwd() : ''
        expect(file).toBe('docker')
        return options.input?.includes('__nontarget_fingerprints') ? JSON.stringify(graph) : 'ok'
      } }))
    vi.doMock('node:fs', async () => ({ ...await vi.importActual<typeof import('node:fs')>('node:fs'),
      statSync: () => ({ isSocket: () => true, dev: 1, ino: 2, mode: 3, rdev: 4 }) }))
    vi.doMock('../../scripts/contextual-assignment-list-proof-lifecycle', async () => {
      const actual = await vi.importActual<typeof import('../../scripts/contextual-assignment-list-proof-lifecycle')>('../../scripts/contextual-assignment-list-proof-lifecycle')
      return { ...actual, runAssignmentListEphemeralLifecycle: async (...args: Parameters<typeof actual.runAssignmentListEphemeralLifecycle>) => {
        adapters = args[1]
        // The unrelated reorder SDK matrix is not under test. Keep real parent
        // case/session iteration and all genuine adopter revocation wrappers.
        const composed = { ...adapters,
          verifyEphemeral: (r: Parameters<AssignmentListLifecycleAdapters['verifyEphemeral']>[0]) => adapters.verifyEphemeral(revoked && corruption === 'restore-target'
            ? { ...r, target: { ...r.target, API_URL: 'http://127.0.0.1:54330' } }
            : revoked && corruption === 'restore-session' ? { ...r, applicationName: 'foreign' } : r),
          executeSql: (r: Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]) => adapters.executeSql(revoked && corruption === 'restore-sql'
            ? { ...r, sql: r.sql + 'select 1;' } : revoked && corruption === 'restore-container' ? { ...r, containerId: 'f'.repeat(64) } : r),
          verifyRestoration: (r: Parameters<AssignmentListLifecycleAdapters['verifyRestoration']>[0]) => adapters.verifyRestoration(corruption === 'verify-plan'
            ? { ...r, plan: { ...r.plan, actorId: 'foreign' } } : corruption === 'verify-fixture' ? { ...r, fixture: { ...r.fixture } }
            : corruption === 'verify-target' ? { ...r, target: { ...r.target, API_URL: 'http://127.0.0.1:54330' } } : r),
          runCase: async (r: Parameters<AssignmentListLifecycleAdapters['runCase']>[0]) => {
          events.push('case'); return { actorId: r.proofCase.actorId, classroomId: r.proofCase.classroomId, status: r.proofCase.expectedStatus }
        } }
        try { return await actual.runAssignmentListEphemeralLifecycle(args[0], composed) }
        catch (error) { failure = error as typeof failure; throw error }
      } }
    })
    vi.doMock('../../scripts/contextual-assignment-list-proof-platform', async () => {
      const actual = await vi.importActual<typeof import('../../scripts/contextual-assignment-list-proof-platform')>('../../scripts/contextual-assignment-list-proof-platform')
      const observer = await vi.importActual<typeof import('../../scripts/contextual-assignment-list-proof-revocations')>('../../scripts/contextual-assignment-list-proof-revocations')
      return { ...actual, createAssignmentListNativeAdapters: () => ({
        async canonicalSnapshot(request: unknown) {
          canonicalRequests.push(structuredClone(request)); events.push(canonicalRequests.length === 1 ? 'before' : 'after')
          if (canonicalRequests.length === 1) return { ...canonical }
          return Object.defineProperties({}, Object.fromEntries(Object.keys(canonical).map(field => [field, { enumerable: true,
            get: () => { fieldReads.push(field); return drift === field ? (field === 'rowDigests' ? canonical.rowDigests.replace('a'.repeat(32), 'b'.repeat(32)) : 'changed') : canonical[field as keyof typeof canonical] } }])))
        },
        async inventory() { return { resources: structuredClone(resources), occupiedPorts: running ? [54331, 54332] : [], workdirExists: exists } },
        async prepare(p: { projectId: string; workdir: string; config: string }, migrations: Array<{ name: string; sha256: string }>) {
          project = p.projectId; exists = true
          return { workdir: p.workdir, realpath: p.workdir, created: true, configSha256: testOwnerDigest(p.config),
            migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] }
        },
        async command(r: { args: string[] }) {
          if (r.args[0] === 'start') { running = true; resources = actual.assignmentListExpectedResources(project).map((x, i) => ({ ...x,
            id: (i + 1).toString(16).padStart(64, '0'), createdAt: '2026-10-08T19:40:00Z', attachedIds: [],
            labels: { 'com.supabase.cli.project': project, 'com.docker.compose.project': project },
            ports: x.kind === 'container' && x.name.startsWith('supabase_db_') ? [54332] : x.name.startsWith('supabase_kong_') ? [54331] : [] })); return }
          return { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:demo@127.0.0.1:54332/postgres',
            SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature` }
        },
        async verifyEphemeral(r: Parameters<AssignmentListLifecycleAdapters['verifyEphemeral']>[0]) {
          if (active && revoked && r.target.API_URL === 'http://127.0.0.1:54331' && r.projectId === project) {
            events.push('restore-session')
            if (expiry === 'restore-session') clock += 900001
          }
          return { ...r, containerId: resources[0].id, guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true }
        },
        async executeSql(r: Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]) {
          if (!active) return
          if (!revoked) {
            events.push('revoke-pending')
            // Let the transition remain pending while ordinary work expires.
            await Promise.resolve(); if (expiry.startsWith('pending-')) clock += 900001
            revoked = true; events.push('revoke-settled')
            if (expiry === 'pending-rejected') throw Error('Ambiguous transition response')
          } else {
            restores++; events.push('restore-sql'); if (expiry === 'restore-sql') clock += 900001
            await expect(adapters.verifyEphemeral({ projectId: 'foreign', dbPort: 54332, applicationName: project + '_fixture',
              target: { API_URL: 'http://127.0.0.1:54330', DB_URL: 'wrong', SERVICE_ROLE_KEY: 'wrong' } })).rejects.toThrow()
          }
        },
        async runRevocation(r: Parameters<AssignmentListLifecycleAdapters['runRevocation']>[0]) {
          active = true; events.push('revocation')
          await expect(r.executeSql(r.plan.restoreSql + 'select 1;')).rejects.toThrow()
          await expect(r.verifyRestoration({ ...r.plan, actorId: 'foreign' })).rejects.toThrow()
          await expect(adapters.runRevocation({ ...r, plan: { ...r.plan, actorId: 'foreign' } })).rejects.toThrow()
          await expect(adapters.runRevocation({ ...r, fixture: { ...r.fixture } })).rejects.toThrow()
          try { return await observer.observeAssignmentListRevocation({ ...r, transition: r.executeSql,
            originalFetch: async (request) => {
              const select = new URL(request instanceof Request ? request.url : String(request)).searchParams.get('select') ?? ''
              if (select.includes('assignments:')) { events.push('read-failed'); return new Response('{}', { status: 500 }) }
              return new Response(JSON.stringify({ id: r.plan.classroomId, teacher_id: r.plan.actorId, archived_at: null,
                ...(select.includes('feature_visibility') ? { feature_visibility: {} } : {}) }), { status: 200 })
            } }) }
          finally {
            events.push('observer-settled'); active = false
            // Even exact SQL/verification cannot be replayed after the phase.
            await expect(r.executeSql(r.plan.restoreSql)).rejects.toThrow()
            await expect(r.verifyRestoration(r.plan)).rejects.toThrow()
            await expect(adapters.runRevocation(r)).rejects.toThrow()
            await expect(adapters.runCase({ fixture: r.fixture, proofCase: r.fixture.manifest.cases[0], target: r.target })).rejects.toThrow()
          }
        },
        async verifyRestoration(r: Parameters<AssignmentListLifecycleAdapters['verifyRestoration']>[0]) {
          verifications++; events.push('verify-restoration')
          await expect(adapters.verifyRestoration({ ...r, plan: { ...r.plan, actorId: 'foreign' } })).rejects.toThrow()
          await expect(adapters.verifyRestoration({ ...r, target: { ...r.target, API_URL: 'http://127.0.0.1:54330' } })).rejects.toThrow()
          await expect(adapters.verifyRestoration({ ...r, fixture: { ...r.fixture } })).rejects.toThrow()
          await expect(adapters.executeSql({ projectId: project, dbPort: 54332, containerId: 'f'.repeat(64), applicationName: project + '_fixture', sql: r.plan.restoreSql })).rejects.toThrow()
          if (verificationFails) throw Error('Restoration verification failed')
          return { nonTargetBefore: 'exact', nonTargetAfter: 'exact', semanticRestored: true, changedCells: [] }
        },
        async teardown(r: Parameters<AssignmentListLifecycleAdapters['teardown']>[0]) {
          expect(r.resources).toEqual(resources); expect(r.stopArgs).toEqual(['stop', '--project-id', project, '--no-backup'])
          events.push('teardown'); running = false; resources = []
        },
        async removeWorkdir(r: Parameters<AssignmentListLifecycleAdapters['removeWorkdir']>[0]) {
          expect(r.projectId).toBe(project); expect(r.workdir).toBe(r.realpath); events.push('remove'); exists = false
        },
      }) }
    })
    vi.doMock('../../scripts/contextual-test-reorder-proof-fixture', async () => ({
      ...await vi.importActual<typeof import('../../scripts/contextual-test-reorder-proof-fixture')>('../../scripts/contextual-test-reorder-proof-fixture'), validateTestOwnerReorderSetupSnapshot: vi.fn() }))
    vi.doMock('../../scripts/contextual-test-reorder-proof-transport', async () => ({
      ...await vi.importActual<typeof import('../../scripts/contextual-test-reorder-proof-transport')>('../../scripts/contextual-test-reorder-proof-transport'),
      createTestOwnerReorderProofTransport: () => ({ counts: { exchangeBytes: 0 }, diagnostic: () => '' }) }))
    vi.doMock('../../scripts/contextual-test-draft-save-proof-inventory', () => ({ draftSaveProofDockerInventory: async (o: { stat: (s: string) => unknown }) => {
      o.stat('/private/tmp/offline-restoration.sock'); return structuredClone(resources)
    } }))
    vi.doMock('../../scripts/contextual-test-draft-save-native-contracts', async () => {
      const actual = await vi.importActual<typeof import('../../scripts/contextual-test-draft-save-native-contracts')>('../../scripts/contextual-test-draft-save-native-contracts')
      return { ...actual, createTestOwnerReorderNativeContracts: (r: Parameters<typeof actual.createTestOwnerReorderNativeContracts>[0]) => ({
        setup: async () => ({ fixtureSha256: testOwnerDigest(JSON.stringify(r.fixture)), setupSha256: testOwnerDigest(actual.buildTestOwnerReorderNativeContractsManifest(r.original, r.fixture, r.reviewedHead, r.repository).setup) }), diagnostic: () => '' }) }
    })
    const main = await import('../../scripts/check-contextual-test-owner-reorder-lifecycle')
    await expect(main.testOwnerReorderLifecycleMain(['--reviewed-head', 'a'.repeat(40), '--mode', 'normal'])).rejects.toThrow('private details withheld')
    expect(events.filter(e => e === 'revocation')).toHaveLength(1)
    expect(restores).toBe(corruption?.startsWith('restore-') ? 0 : 1)
    expect(verifications).toBe(corruption ? 0 : 1)
    if (!corruption) {
      expect(events.indexOf('restore-session')).toBeGreaterThan(events.indexOf('revoke-settled'))
      expect(events.indexOf('verify-restoration')).toBeGreaterThan(events.indexOf('restore-sql'))
    }
    expect(events.slice(-3)).toEqual(['teardown', 'remove', 'after'])
    expect(resources).toEqual([]); expect(exists).toBe(false); expect(running).toBe(false)
    expect(canonicalRequests).toHaveLength(2); expect(canonicalRequests[0]).toEqual(canonicalRequests[1])
    expect(new Set(fieldReads)).toEqual(new Set(Object.keys(canonical)))
    expect(failure?.primary?.stage).toBe('revocations'); expect(failure?.primary?.error).toBeDefined()
    if (verificationFails) expect((failure?.primary?.error as Error).message).toContain('Restoration verification failed')
    expect(failure?.cleanupFailures.map(x => x.stage)).toEqual(drift ? ['canonical-after'] : [])
    if (drift) {
      const error = failure?.cleanupFailures[0].error as { operator: string; expected: unknown; actual: Record<string, string> }
      expect(error.operator).toBe('deepStrictEqual'); expect(error.expected).toEqual(canonical)
      expect(Object.keys(error.actual).sort()).toEqual(Object.keys(canonical).sort()); expect(error.actual[drift]).not.toBe(canonical[drift as keyof typeof canonical])
    }
    expect(stdout).not.toHaveBeenCalled()
  }
  it.each(['pending-fulfilled', 'pending-rejected', 'restore-session', 'restore-sql'] as const)('restores once through expiry at %s and retains failure', expiry => run(expiry))
  it.each(['restore-target', 'restore-session', 'restore-sql', 'restore-container', 'verify-plan', 'verify-fixture', 'verify-target'])
    ('denies corrupted %s at the live exact-restoration boundary', corruption => run('pending-fulfilled', undefined, false, corruption))
  it('retains restoration verification failure after ambiguous settlement', () => run('pending-rejected', undefined, true))
  it.each(['rowDigests', 'guard168Metadata', 'settings', 'cronJobs', 'resources'])('retains exact canonical %s comparison after restoration', field => run('pending-fulfilled', field))
})
