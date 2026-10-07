import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { AssertionError } from 'node:assert'
import ts from 'typescript'
import { AssignmentListLifecycleError, runAssignmentListEphemeralLifecycle, type AssignmentListLifecycleAdapters } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture, TEST_OWNER_REORDER_SNAPSHOT_TABLES, testOwnerReorderTableCatalogFromCanonical } from '../../scripts/contextual-test-reorder-proof-fixture'
import { assignmentListExpectedResources, assignmentListRestorationPolicy, loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from '../../scripts/contextual-assignment-list-proof-revocations'
import { assignmentListProofWorkdir } from '../../scripts/contextual-assignment-list-proof-path'
import {
  parseTestOwnerReorderLifecycleArgs, testOwnerReorderForcedReceipt, validateTestOwnerReorderGeneratedTypes,
  testOwnerReorderUnionManifest, testOwnerReorderMatrixCompletion, validateTestOwnerReorderSnapshotCatalog,
  testOwnerReorderSetupDiagnostic, testOwnerReorderCommittedCompletion, testOwnerReorderAccountingReceipt,
} from '../../scripts/check-contextual-test-owner-reorder-lifecycle'

const generated = `export type Json = unknown;
export type Database = { public: { Functions: { reorder_tests_for_owner_v1: {
Args: { p_actor_id: string; p_classroom_id: string; p_test_ids: string[]; p_deadline: string }; Returns: Json } } } }`
const original = newAssignmentListProofFixture(new Date('2026-10-07T03:00:00Z'))
const fixture = newTestOwnerReorderFixture(original)
const names = [...TEST_OWNER_REORDER_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets', 'public.future_unrelated_table'].sort()
const canonical = { rowDigests: JSON.stringify(Object.fromEntries(names.map(name => [name, { count: 0, digest: 'a'.repeat(32) }]))),
  guard168Metadata: '{}', settings: '{}', cronJobs: '[]', resources: '[]' }
const catalog = testOwnerReorderTableCatalogFromCanonical(canonical)
const graph = () => ({ ...Object.fromEntries(TEST_OWNER_REORDER_SNAPSHOT_TABLES.map(table => [table, []])),
  __bulk_tests: [], __bulk_setup: [], __nontarget_fingerprints: names.map(table => ({ table, fingerprint: 'unchanged' })) })

describe('closed reorder lifecycle source contracts', () => {
  it('validates four required RPC arguments and Json return as supplemental AST evidence', () => {
    expect(validateTestOwnerReorderGeneratedTypes(generated, testOwnerDigest(generated))).toBe(true)
    expect(() => validateTestOwnerReorderGeneratedTypes(generated, '0'.repeat(64))).toThrow()
  })
  it.each([
    generated.replace('p_actor_id: string', 'p_actor_id?: string'), generated.replace('p_actor_id: string', 'p_actor_id: number'),
    generated.replace('p_test_ids: string[]', 'p_test_ids: string'), generated.replace('p_test_ids: string[]', 'p_test_ids: number[]'),
    generated.replace('p_test_ids: string[]', 'p_test_ids: string[] | null'), generated.replace('p_test_ids: string[]', 'p_test_ids: [string]'),
    generated.replace('p_deadline: string', 'p_deadline: number'), generated.replace('p_deadline: string', 'p_deadline: string; extra: string'),
    generated.replace('Returns: Json', 'Returns: unknown'), generated.replace('Returns: Json', 'Returns: string'),
    generated.replace('public:', 'private:'), generated.replace('reorder_tests_for_owner_v1', 'old_function'),
    generated.replace('export type Database', 'type Database'), generated.replace('Args:', 'Args?:'),
    `${generated}; export type Database = {}`, `// ${generated.replaceAll('\n', ' ')}`, `${generated}; /* unterminated`,
  ])('rejects altered, optional, missing and foreign generated declarations %#', source => {
    expect(() => validateTestOwnerReorderGeneratedTypes(source, testOwnerDigest(source))).toThrow()
  })
  it('accepts only historical reviewed-head/mode arguments and normal-only type generation', () => {
    const args = ['--reviewed-head', 'a'.repeat(40), '--mode', 'normal']
    expect(parseTestOwnerReorderLifecycleArgs(args)).toEqual({ head: 'a'.repeat(40), mode: 'normal', generateTypes: false })
    expect(parseTestOwnerReorderLifecycleArgs([...args, '--generate-types'])).toMatchObject({ generateTypes: true })
    for (const extra of ['--target', '--native-profile', '--sql', '--fixture']) expect(() => parseTestOwnerReorderLifecycleArgs([...args, extra])).toThrow()
    expect(() => parseTestOwnerReorderLifecycleArgs(['--head', ...args.slice(1)])).toThrow()
    expect(() => parseTestOwnerReorderLifecycleArgs([...args.slice(0, 3), 'after-fixture', '--generate-types'])).toThrow()
  })
  it.each(['after-fixture', 'before-capture'])('admits forced cleanup evidence only after complete setup and exact failure at %s', mode => {
    const e = new AssignmentListLifecycleError({ stage: mode, error: Error('Forced isolated lifecycle failure') }, [])
    expect(testOwnerReorderForcedReceipt(mode, e, true)).toEqual({ stdout: 'PASS isolated test-owner-reorder exact teardown and unchanged canonical baseline.\n',
      stderr: `FAIL forced isolated test-owner-reorder lifecycle: ${mode}.\n`, exitCode: 1 })
    expect(testOwnerReorderForcedReceipt(mode, e, false)).toBeNull(); expect(testOwnerReorderForcedReceipt('normal', e, true)).toBeNull()
    expect(testOwnerReorderForcedReceipt(mode, new AssignmentListLifecycleError(e.primary, [{ stage: 'teardown', error: Error('private') }]), true)).toBeNull()
    expect(testOwnerReorderForcedReceipt(mode, Error('Forced isolated lifecycle failure'), true)).toBeNull()
  })
  it('freezes the complete253 union while distinguishing rollback proof from remaining gates', () => {
    const union = testOwnerReorderUnionManifest(original, fixture, 'a'.repeat(40), process.cwd())
    expect(Object.isFrozen(union.sql.concurrency.schedules)).toBe(true)
    expect(union.sql.contracts.contracts).toHaveLength(27); expect(union.sql.concurrency.schedules).toHaveLength(21)
    const source = readFileSync('scripts/check-contextual-test-owner-reorder-lifecycle.ts', 'utf8')
    expect(source).toContain('${union.sql.contracts.contracts.length} rollback SQL batches')
    expect(source).not.toContain('nine rollback SQL batches')
    expect(union.applicationCapabilities).toEqual({ controls: 4000, actions: 200, totalMs: 900000, controlMs: 45000, totalBytes: 384 * 1024 * 1024 })
    expect(union.inventory).toMatchObject({ sdkCases: 16, sdkReorders: 6, privilegeDriftProbes: 1, rpcRequests: 17, storageRequests: 0, rollbackSchedules: 21, committedTransitions: 7 })
    expect(union.remainingGates).toEqual(['Successful Blueprint/proposal workflow', 'Enabled purge workflow activation'])
  })
  it('keeps failure diagnostics free of source, actor, SQL and credential details', () => {
    const privateError = Error('private actor uuid sql credential')
    const diagnostic = testOwnerReorderSetupDiagnostic('arbitrary private stage', privateError)
    expect(diagnostic).toContain('setup=unknown'); expect(diagnostic).not.toContain('private')
    expect(testOwnerReorderSetupDiagnostic('sql-setup', new AssignmentListLifecycleError({ stage: 'fixture', error: privateError }, []))).toContain('lifecycle=fixture')
  })
  it.each(['none', 'admission', 'git-head', 'git-root', 'git-status', 'migration-manifest',
    'migration-source', 'inventory', 'resources', 'sql', 'final-check'])
  ('renders only the fixed guard checkpoint %s without inspecting private errors', boundary => {
    const error = Error('PRIVATE SQL credential actor'); error.stack = 'PRIVATE stack'
    const diagnostic = testOwnerReorderSetupDiagnostic('app-guard', new AssignmentListLifecycleError({ stage: 'fixture', error }, []), boundary)
    expect(diagnostic).toContain(`guard=${boundary}`)
    expect(diagnostic).not.toMatch(/PRIVATE|SQL|credential|actor|stack/)
  })
  it.each(['PRIVATE SQL credential', null, {}, 7])('rejects an unfamiliar guard checkpoint %#', boundary => {
    const diagnostic = testOwnerReorderSetupDiagnostic('app-guard', Error('PRIVATE'), boundary)
    expect(diagnostic).toContain('guard=unknown'); expect(diagnostic).not.toContain('PRIVATE')
  })
  it.each(['check-contextual-test-owner-reorder-lifecycle.ts', 'contextual-assignment-list-proof-lifecycle.ts',
    'contextual-assignment-list-proof-platform.ts', 'contextual-assignment-list-proof-revocations.ts',
    'check-contextual-assignment-list-reads.ts', 'contextual-assignment-list-proof-path.ts'])
  ('emits only a bounded first owned assertion coordinate and closed lifecycle evidence: %s', file => {
    for (const column of [7, 81]) {
      const error = new AssertionError({ message: 'restoration-owner', actual: { secret: 'PRIVATE row credential' }, expected: {}, operator: 'strictEqual' })
      // Exact fixed label only. Node24 may append a value diff to strictEqual's
      // supplied message; decorated/lookalike labels must remain unrecognized.
      error.message = 'restoration-owner'
      error.stack = `PRIVATE message\n    at node:internal/assert:20:3\n    at verify (/PRIVATE/secret/scripts/${file}:244:${column})\nPRIVATE SQL`;
      const wrapped = new AssignmentListLifecycleError({ stage: 'revocations', transition: 'owner-transfer', boundary: 'later', error }, [])
      const diagnostic = testOwnerReorderSetupDiagnostic('complete', wrapped)
      expect(diagnostic).toContain(`location=${file}:244:${column}`)
      expect(diagnostic).toContain('transition=owner-transfer boundary=later operator=strictEqual status=none checkpoint=restoration-owner')
      expect(diagnostic).toContain('lifecycle=revocations cleanup=none failure=assertion')
      expect(diagnostic).not.toMatch(/PRIVATE|secret|credential|SQL|\bat verify|node:internal|actual|expected/)
    }
  })
  it.each([
    'PRIVATE only', 'PRIVATE\n    at check (/private/scripts/unrelated.ts:244:7)',
    'PRIVATE\n    at check (/private/scripts/check-contextual-test-owner-reorder-lifecycle.ts:0:7)',
    'PRIVATE\n    at check (/private/scripts/check-contextual-test-owner-reorder-lifecycle.ts:244:0)',
    'PRIVATE\n    at foreign (/private/unrelated.ts:1:2)\n    at check (/private/scripts/check-contextual-test-owner-reorder-lifecycle.ts:244:7)',
    'PRIVATE\n    at check (/private/scripts/check-contextual-test-owner-reorder-lifecycle.ts:244:7) PRIVATE',
    'x'.repeat(8193),
  ])('rejects malformed, foreign, later or oversized assertion stack without rendering it %#', stack => {
    const error = new AssertionError({ message: 'PRIVATE row credential', operator: 'PRIVATE' }); error.stack = stack
    const diagnostic = testOwnerReorderSetupDiagnostic('complete', new AssignmentListLifecycleError({ stage: 'revocations', error }, []))
    expect(diagnostic).toContain('location=unknown')
    expect(diagnostic).toContain('operator=none status=none checkpoint=none')
    expect(diagnostic).not.toMatch(/PRIVATE|row|credential|unrelated|\/private|xxxx/)
  })
  it('reuses only exact restoration checkpoint labels, never decorated lookalikes', () => {
    for (const label of ['restoration-scope', 'restoration-nontarget', 'restoration-owner',
      'restoration-archive', 'restoration-visibility', 'restoration-member']) {
      const error = new AssertionError({ message: label, actual: false, expected: true, operator: '==' })
      const diagnostic = testOwnerReorderSetupDiagnostic('complete', new AssignmentListLifecycleError({ stage: 'revocations', error }, []))
      expect(diagnostic).toContain(`checkpoint=${label}`)
      error.message = `${label}\nPRIVATE row credential`
      const decorated = testOwnerReorderSetupDiagnostic('complete', new AssignmentListLifecycleError({ stage: 'revocations', error }, []))
      expect(decorated).toContain('checkpoint=none'); expect(decorated).not.toMatch(/PRIVATE|row|credential/)
    }
  })
  it('reports the actual200-per-layer action sum and reserves cleanup/native bytes without claiming opaque IO', () => {
    const union = testOwnerReorderUnionManifest(original, fixture, 'a'.repeat(40), process.cwd())
    const calls = Object.fromEntries(Object.keys(union.inheritedLifecycleCapabilities).map(k => [k, 0]))
    const result = testOwnerReorderAccountingReceipt(union, { controls: 100, actions: 115, exchangeBytes: 1000 },
      { controls: 300, actions: 144, exchangeBytes: 2000 }, 3000, { attempts: 1, bytes: 4000 }, calls)
    expect(result.countedActions).toEqual({ application: 115, nativeCumulativeAtCommitted: 144, sum: 259, applicationCeiling: 200, nativeCeiling: 200, sumCeiling: 400 })
    expect(result.exchange.accountedUpperBoundBytes).toBe(1000 + 4000 + 3000 + 64 * 1024 * 1024)
    expect(result.exchange.ceiling).toBe(384 * 1024 * 1024)
    expect(result.inherited.scope).toBe('adapter-calls-not-internal-SQL-or-bytes')
    expect(result.exchange.excludes).toEqual(['opaque inherited adapter IO', 'opaque type-generator CLI IO'])
    expect(() => testOwnerReorderAccountingReceipt(union, { controls: 0, actions: 201, exchangeBytes: 1 },
      { controls: 0, actions: 0, exchangeBytes: 0 }, 0, { attempts: 1, bytes: 1 }, calls)).toThrow()
    expect(() => testOwnerReorderAccountingReceipt(union, { controls: 0, actions: 0, exchangeBytes: 1 },
      { controls: 0, actions: 201, exchangeBytes: 0 }, 0, { attempts: 1, bytes: 1 }, calls)).toThrow()
  })
  it('derives exact inherited ceilings from the actual normal parent, including both scoped SQL sessions per revocation', async () => {
    const union = testOwnerReorderUnionManifest(original, fixture, 'a'.repeat(40), process.cwd()), caps = union.inheritedLifecycleCapabilities
    const calls = { canonicalSnapshot: 0, inventory: 0, prepare: 0, command: 0, verifyEphemeral: 0, executeSql: 0,
      runCase: 0, runRevocation: 0, verifyRestoration: 0, teardown: 0, removeWorkdir: 0 }
    const project = `pika_assignment_list_${original.manifest.syntheticTag.slice(-12)}`, workdir = assignmentListProofWorkdir(project)
    let running = false, exists = false
    const resources = assignmentListExpectedResources(project).map((r, index) => ({ ...r, id: (index + 1).toString(16).padStart(64, '0'),
      createdAt: '2026-10-07T03:00:00Z', labels: { 'com.supabase.cli.project': project, 'com.docker.compose.project': project }, attachedIds: [],
      ports: r.name.startsWith('supabase_db_') && r.kind === 'container' ? [54332] : r.name.startsWith('supabase_kong_') ? [54331] : [] }))
    const adapters: AssignmentListLifecycleAdapters = {
      async canonicalSnapshot() { calls.canonicalSnapshot++; return { ...canonical } },
      async inventory() { calls.inventory++; return { resources: running ? structuredClone(resources) : [], occupiedPorts: running ? [54331,54332] : [], workdirExists: exists } },
      async prepare(plan, migrations) { calls.prepare++; exists = true; return { workdir, realpath: workdir, created: true,
        configSha256: testOwnerDigest(plan.config), migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] } },
      async command(request) { calls.command++; if (request.args[0] === 'start') { running = true; return }
        return { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:demo@127.0.0.1:54332/postgres',
          SERVICE_ROLE_KEY: `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature` } },
      async verifyEphemeral(request) { calls.verifyEphemeral++; return { ...request, containerId: resources[0].id,
        guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true } },
      async executeSql() { calls.executeSql++ },
      async runCase(request) { calls.runCase++; return { actorId: request.proofCase.actorId, classroomId: request.proofCase.classroomId, status: request.proofCase.expectedStatus } },
      async runRevocation(request) { calls.runRevocation++; await request.executeSql(request.plan.revokeSql)
        await request.executeSql(request.plan.restoreSql); await request.verifyRestoration(request.plan)
        return { transition: request.plan.transition, boundary: request.plan.boundary, expectedStatus: request.plan.expectedStatus } },
      async verifyRestoration() { calls.verifyRestoration++; return { nonTargetBefore: 'unchanged', nonTargetAfter: 'unchanged', semanticRestored: true, changedCells: [] } },
      async teardown() { calls.teardown++; running = false },
      async removeWorkdir() { calls.removeWorkdir++; exists = false },
    }
    await runAssignmentListEphemeralLifecycle({ fixture: original, projectId: project, workdir, mode: 'normal',
      migrations: loadAssignmentListReviewedMigrations(process.cwd()), expectedResources: assignmentListExpectedResources(project),
      reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
      restorationPolicies: assignmentListRevocationPlans(original).map(p => assignmentListRestorationPolicy(original, p)) }, adapters)
    expect(calls).toEqual(caps); expect(running).toBe(false); expect(exists).toBe(false)
    expect(calls.verifyEphemeral).toBe(1 + original.manifest.cases.length + 3 * assignmentListRevocationPlans(original).length)
  })
})

describe.sequential('actual original lifecycle with offline platform faults', () => {
  const guardFaults = ['guard-git-head', 'guard-git-root', 'guard-git-status', 'guard-migration-manifest',
    'guard-migration-source', 'guard-inventory', 'guard-resources', 'guard-sql', 'guard-replaced', 'guard-success-later'] as const
  afterEach(() => {
    vi.restoreAllMocks(); vi.resetModules()
    for (const name of ['node:child_process', 'node:fs', '../../scripts/contextual-assignment-list-proof-platform',
      '../../scripts/contextual-assignment-list-proof-lifecycle', '../../scripts/contextual-test-reorder-proof-fixture',
      '../../scripts/contextual-test-reorder-proof-transport', '../../scripts/contextual-test-draft-save-native-contracts',
      '../../scripts/contextual-test-draft-save-proof-inventory']) vi.doUnmock(name)
  })
  it('keeps guarded-main revocation failure failed and emits only its closed diagnostic', async () => {
    vi.resetModules()
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const error = new AssertionError({ message: 'restoration-nontarget', actual: 'PRIVATE row', expected: 'SECRET credential', operator: 'strictEqual' })
    error.message = 'restoration-nontarget'
    error.stack = 'PRIVATE\n    at verify (/SECRET/scripts/contextual-assignment-list-proof-platform.ts:330:19)'
    const exec = vi.fn((file: string, args: string[]) => {
      expect(file).toBe('git'); return args[0] === 'rev-parse' ? args[1] === 'HEAD' ? 'a'.repeat(40) : process.cwd() : ''
    })
    vi.doMock('node:child_process', async () => ({ ...await vi.importActual<typeof import('node:child_process')>('node:child_process'), execFileSync: exec }))
    vi.doMock('../../scripts/contextual-assignment-list-proof-lifecycle', async () => {
      const actual = await vi.importActual<typeof import('../../scripts/contextual-assignment-list-proof-lifecycle')>('../../scripts/contextual-assignment-list-proof-lifecycle')
      return { ...actual, runAssignmentListEphemeralLifecycle: async () => {
        throw new actual.AssignmentListLifecycleError({ stage: 'revocations', transition: 'visibility', boundary: 'terminal', error }, [])
      } }
    })
    const main = await import('../../scripts/check-contextual-test-owner-reorder-lifecycle')
    await expect(main.testOwnerReorderLifecycleMain(['--reviewed-head', 'a'.repeat(40), '--mode', 'normal'])).rejects.toThrow('private details withheld')
    const diagnostic = stderr.mock.calls.map(call => call[0]).join('')
    expect(diagnostic).toContain('location=contextual-assignment-list-proof-platform.ts:330:19')
    expect(diagnostic).toContain('transition=visibility boundary=terminal operator=strictEqual status=none checkpoint=restoration-nontarget')
    expect(diagnostic).not.toMatch(/PRIVATE|SECRET|credential|row|PASS/)
    expect(output).not.toHaveBeenCalled()
  })
  async function faultRun(fault: 'clock' | 'actions' | 'case-clock' | 'prepare-clock' | typeof guardFaults[number], changedField?: keyof typeof canonical) {
    vi.resetModules()
    const events: string[] = [], canonicalRequests: unknown[] = [], fieldReads: string[] = []
    let launched = false, workdirExists = false, project = '', resources: import('../../scripts/contextual-assignment-list-proof-lifecycle').AssignmentListResource[] = []
    let failure: import('../../scripts/contextual-assignment-list-proof-lifecycle').AssignmentListLifecycleError | undefined
    let guard: (() => Promise<void>) | undefined, clock = Date.parse('2026-10-07T03:00:00Z'), sourceReads = 0
    vi.spyOn(Date, 'now').mockImplementation(() => clock)
    const output = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    vi.doMock('node:child_process', async () => ({ ...await vi.importActual<typeof import('node:child_process')>('node:child_process'),
      execFileSync: (file: string, args: string[], options: { input?: string }) => {
        if (file === 'git') {
          if (launched && (fault === 'guard-git-head' && args[0] === 'rev-parse' && args[1] === 'HEAD'
            || fault === 'guard-git-root' && args[0] === 'rev-parse' && args[1] === '--show-toplevel'
            || fault === 'guard-git-status' && args[0] === 'status')) throw Error('PRIVATE git credential')
          return args[0] === 'rev-parse' ? args[1] === 'HEAD' ? 'a'.repeat(40) : process.cwd() : ''
        }
        expect(file).toBe('docker'); expect(options.input).toBeTypeOf('string'); events.push('private-sql')
        if (fault === 'guard-sql') throw Error('PRIVATE SQL row credential')
        return options.input!.includes('jsonb_build_object') && options.input!.includes('__nontarget_fingerprints') ? JSON.stringify(graph()) : 'ok'
      } }))
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
      return { ...actual,
        statSync: () => ({ isSocket: () => true, dev: 1, ino: 2, mode: 3, rdev: 4 }),
        readdirSync: (...args: Parameters<typeof actual.readdirSync>) => {
          if (launched && fault === 'guard-migration-manifest') throw Error('PRIVATE directory credential')
          return actual.readdirSync(...args)
        },
        readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
          if (launched && fault === 'guard-migration-source' && typeof args[0] === 'string'
            && args[0].endsWith('/253_contextual_test_owner_reorder.sql') && ++sourceReads === 2) throw Error('PRIVATE source credential')
          return actual.readFileSync(...args)
        },
      }
    })
    vi.doMock('../../scripts/contextual-assignment-list-proof-lifecycle', async () => {
      const actual = await vi.importActual<typeof import('../../scripts/contextual-assignment-list-proof-lifecycle')>('../../scripts/contextual-assignment-list-proof-lifecycle')
      return { ...actual, runAssignmentListEphemeralLifecycle: async (...args: Parameters<typeof actual.runAssignmentListEphemeralLifecycle>) => {
        try { return await actual.runAssignmentListEphemeralLifecycle(...args) }
        catch (error) {
          failure = error as typeof failure
          if (fault === 'guard-replaced') {
            failure = new actual.AssignmentListLifecycleError({ stage: 'fixture', error: Error('PRIVATE replacement credential') }, failure!.cleanupFailures)
            throw failure
          }
          throw error
        }
      } }
    })
    vi.doMock('../../scripts/contextual-assignment-list-proof-platform', async () => {
      const actual = await vi.importActual<typeof import('../../scripts/contextual-assignment-list-proof-platform')>('../../scripts/contextual-assignment-list-proof-platform')
      return { ...actual, createAssignmentListNativeAdapters: () => ({
        async canonicalSnapshot(request: unknown) {
          canonicalRequests.push(structuredClone(request)); events.push(canonicalRequests.length === 1 ? 'canonical-before' : 'canonical-after')
          const value = { ...canonical, ...(changedField ? { [changedField]: changedField === 'rowDigests'
            ? canonical.rowDigests.replace('a'.repeat(32), 'b'.repeat(32)) : 'changed' } : {}) }
          if (canonicalRequests.length === 1) return { ...canonical }
          return Object.defineProperties({}, Object.fromEntries(Object.keys(value).map(field => [field, { enumerable: true,
            get: () => { fieldReads.push(field); return value[field as keyof typeof value] } }])))
        },
        async inventory() { events.push(launched ? 'inventory-present' : 'inventory-absent'); return { resources: structuredClone(resources), occupiedPorts: launched ? [54331,54332] : [], workdirExists } },
        async prepare(plan: { projectId: string; workdir: string; config: string }, migrations: Array<{ name: string; sha256: string }>) {
          events.push('prepare'); project = plan.projectId; workdirExists = true
          if (fault === 'prepare-clock') clock += 900001
          return { workdir: plan.workdir, realpath: plan.workdir, created: true, configSha256: testOwnerDigest(plan.config), migrations: migrations.map(({ name, sha256 }) => ({ name, sha256 })), envFiles: [], symlinks: [] }
        },
        async command(request: { args: string[] }) {
          events.push(`command-${request.args[0]}`)
          if (request.args[0] === 'start') {
            launched = true; resources = actual.assignmentListExpectedResources(project).map((r, index) => ({ ...r,
              id: (index + 1).toString(16).padStart(64, '0'), createdAt: '2026-10-07T03:00:00Z',
              labels: { 'com.supabase.cli.project': project, 'com.docker.compose.project': project }, attachedIds: [],
              ports: r.name.startsWith('supabase_db_') && r.kind === 'container' ? [54332] : r.name.startsWith('supabase_kong_') ? [54331] : [] }))
            return
          }
          const token = `header.${Buffer.from(JSON.stringify({ iss: 'supabase-demo', role: 'service_role' })).toString('base64url')}.signature`
          return { API_URL: 'http://127.0.0.1:54331', DB_URL: 'postgresql://postgres:demo@127.0.0.1:54332/postgres', SERVICE_ROLE_KEY: token }
        },
        async verifyEphemeral(request: object) { events.push('verify-ephemeral'); return { ...request, containerId: resources[0].id,
          guard168Enabled: true, persistedGatesOff: true, activeNetworkCronAbsent: true } },
        async executeSql() {
          events.push('inherited-sql'); if (fault === 'clock') clock += 900001
          if (fault === 'guard-success-later' && events.filter(e => e === 'inherited-sql').length === 2) throw Error('PRIVATE later credential')
        },
        async runCase(request: { proofCase: { actorId: string; classroomId: string; expectedStatus: string } }) { events.push('inherited-case');
          if (fault === 'case-clock') clock += 900001
          return { actorId: request.proofCase.actorId, classroomId: request.proofCase.classroomId, status: request.proofCase.expectedStatus } },
        async runRevocation() { events.push('inherited-revocation'); throw Error('Must not resume') },
        async verifyRestoration() { events.push('inherited-restoration'); throw Error('Must not resume') },
        async teardown() { events.push('teardown'); launched = false; resources = [] },
        async removeWorkdir() { events.push('remove-workdir'); workdirExists = false },
      }) }
    })
    if (fault === 'actions' || fault === 'case-clock' || fault.startsWith('guard-')) {
      vi.doMock('../../scripts/contextual-test-reorder-proof-fixture', async () => ({
        ...await vi.importActual<typeof import('../../scripts/contextual-test-reorder-proof-fixture')>('../../scripts/contextual-test-reorder-proof-fixture'), validateTestOwnerReorderSetupSnapshot: vi.fn(),
      }))
      vi.doMock('../../scripts/contextual-test-reorder-proof-transport', async () => ({
        ...await vi.importActual<typeof import('../../scripts/contextual-test-reorder-proof-transport')>('../../scripts/contextual-test-reorder-proof-transport'),
        createTestOwnerReorderProofTransport: (_f: unknown, _target: unknown, _project: unknown, _fetch: unknown, g: () => Promise<void>) => {
          guard = g; return { counts: { exchangeBytes: 0 }, diagnostic: () => 'offline transport\n' }
        },
      }))
      vi.doMock('../../scripts/contextual-test-draft-save-proof-inventory', () => ({ draftSaveProofDockerInventory: async (options: { stat: (path: string) => unknown }) => {
        if (fault === 'guard-inventory' || fault === 'guard-replaced') throw Error('PRIVATE inventory socket credential')
        if (fault === 'guard-resources') return structuredClone(resources).slice(1)
        options.stat('/private/tmp/offline-only-docker.sock'); return structuredClone(resources)
      } }))
      vi.doMock('../../scripts/contextual-test-draft-save-native-contracts', async () => {
        const actual = await vi.importActual<typeof import('../../scripts/contextual-test-draft-save-native-contracts')>('../../scripts/contextual-test-draft-save-native-contracts')
        return { ...actual, createTestOwnerReorderNativeContracts: (input: Parameters<typeof actual.createTestOwnerReorderNativeContracts>[0]) => {
          const m = actual.buildTestOwnerReorderNativeContractsManifest(input.original, input.fixture, input.reviewedHead, input.repository)
          return { setup: async () => ({ fixtureSha256: testOwnerDigest(JSON.stringify(input.fixture)), setupSha256: testOwnerDigest(m.setup) }),
            verifyTarget: async () => undefined, diagnostic: () => 'offline native\n', probeReorderPrivilegeDrift: async () => {
              events.push('action-saturation'); for (let i = 0; i < 201; i++) await guard!(); throw Error('Action cap must reject')
            } }
        } }
      })
    }
    const main = await import('../../scripts/check-contextual-test-owner-reorder-lifecycle')
    await expect(main.testOwnerReorderLifecycleMain(['--reviewed-head', 'a'.repeat(40), '--mode', 'normal'])).rejects.toThrow('private details withheld')
    if (fault === 'prepare-clock') expect(events).not.toContain('teardown')
    else expect(events).toContain('teardown')
    expect(events).toContain('remove-workdir')
    expect(events.lastIndexOf('inventory-absent')).toBeGreaterThan(events.indexOf('remove-workdir'))
    expect(canonicalRequests).toHaveLength(2); expect(canonicalRequests[1]).toEqual(canonicalRequests[0])
    expect(new Set(fieldReads)).toEqual(new Set(Object.keys(canonical)))
    expect(events.at(-1)).toBe('canonical-after'); expect(workdirExists).toBe(false); expect(resources).toEqual([])
    expect(output).not.toHaveBeenCalled(); expect(failure?.primary).toBeDefined()
    if (changedField) {
      const comparison = failure?.cleanupFailures.find(f => f.stage === 'canonical-after')?.error as { operator?: string; actual?: typeof canonical; expected?: typeof canonical }
      expect(comparison.operator).toBe('deepStrictEqual'); expect(comparison.expected).toEqual(canonical)
      expect(Object.keys(comparison.actual!).sort()).toEqual(Object.keys(canonical).sort())
      expect(comparison.actual?.[changedField]).not.toBe(canonical[changedField])
    }
    else expect(failure?.cleanupFailures).toEqual([])
    expect(events).not.toContain('inherited-revocation'); expect(events).not.toContain('inherited-restoration')
    if (fault.startsWith('guard-')) {
      const boundary = fault === 'guard-replaced' || fault === 'guard-success-later' ? 'none' : fault.slice('guard-'.length)
      const diagnostic = stderr.mock.calls.map(call => call[0]).join('')
      expect(diagnostic).toContain(`guard=${boundary}`)
      expect(diagnostic).toContain(`setup=${fault === 'guard-success-later' ? 'app-write' : 'app-guard'} lifecycle=fixture cleanup=none failure=${fault === 'guard-resources' ? 'assertion' : 'unknown'}`)
      expect(diagnostic).not.toMatch(/PRIVATE|credential|row|socket|PASS/)
      expect(events.filter(e => e === 'inherited-sql')).toHaveLength(fault === 'guard-success-later' ? 2 : 1)
      expect(events).not.toContain('inherited-case'); expect(events).not.toContain('action-saturation')
    }
    return events
  }
  it('still tears down and compares all five canonical fields after the absolute execution clock expires', async () => {
    const events = await faultRun('clock'); expect(events).not.toContain('inherited-case')
  })
  it('still tears down and compares all five canonical fields after the app action budget is exhausted', async () => {
    const events = await faultRun('actions'); expect(events).toContain('action-saturation')
    expect(events.filter(e => e === 'private-sql')).toHaveLength(199)
    // More than 200 real source-manifest guards run under parallel focused/CI
    // load. Bound this test only; its actual action/deadline/cleanup caps stay fixed.
  }, 15000)
  it('does not start the matrix or remaining inherited cases/revocations after a read crosses the deadline', async () => {
    const events = await faultRun('case-clock'); expect(events.filter(e => e === 'inherited-case')).toHaveLength(1)
    expect(events).not.toContain('action-saturation')
  })
  it('retains the exact prepare ownership receipt for cleanup without starting after exhaustion', async () => {
    const events = await faultRun('prepare-clock'); expect(events).not.toContain('command-start'); expect(events).not.toContain('inherited-sql')
  })
  it.each(guardFaults)('locates %s failures without exposing private errors or skipping cleanup', fault => faultRun(fault))
  it.each(Object.keys(canonical) as Array<keyof typeof canonical>)('never turns canonical-after %s drift into PASS after exhaustion', field => faultRun('clock', field))
})

describe('reorder snapshot/completion admission', () => {
  it('uses the privately issued canonical complete catalog, retaining unrelated future tables', () => {
    expect(validateTestOwnerReorderSnapshotCatalog(graph(), catalog)).toEqual(graph())
    const missing = graph(); missing.__nontarget_fingerprints.pop(); expect(() => validateTestOwnerReorderSnapshotCatalog(missing, catalog)).toThrow()
    const duplicate = graph(); duplicate.__nontarget_fingerprints.push(duplicate.__nontarget_fingerprints[0]); expect(() => validateTestOwnerReorderSnapshotCatalog(duplicate, catalog)).toThrow()
    expect(() => validateTestOwnerReorderSnapshotCatalog({ ...graph(), extra: [] }, catalog)).toThrow()
    expect(() => validateTestOwnerReorderSnapshotCatalog(graph(), [...catalog])).toThrow()
  })
  function completionDouble() {
    const cases = [...fixture.privilegeProbes, ...fixture.cases]; const labels = cases.map(c => c.label)
    const ledger = Object.freeze(cases.map(c => ({ kind: c.expectedHTTP === 200 ? 'reorder' : 'denial', caseLabel: c.label, state: 'verified' })))
    return { labels, value: { getVerifiedLedger: () => ledger, counts: { rpc: 17, network: 17, storage: 0, snapshots: 34 },
      evidence: { rawPrivilegeFailures: 1, rawPrivilegeContexts: ['253'], restoredPrivilegeContexts: ['253'] },
      completion: () => Object.freeze({ complete: true, verifiedContextLabels: labels }) } }
  }
  // These incomplete offline doubles test only supplemental completion checks.
  // The real adopter uses the sealed issued ledger and full-effect verifier.
  const complete = (value: unknown, labels: readonly string[]) => testOwnerReorderMatrixCompletion(fixture,
    value as Parameters<typeof testOwnerReorderMatrixCompletion>[1], labels)
  it('requires all17 contexts,34 captures,6 successful reorders and restored actual privilege evidence', () => {
    const { value, labels } = completionDouble()
    expect(complete(value, labels)).toEqual({ sdkCases: 16, sdkReorders: 6, rpcRequests: 17, storageRequests: 0, verifiedEffects: 17 })
    expect(() => complete(value, [...labels].reverse())).toThrow()
    expect(() => complete({ ...value, counts: { ...value.counts, rpc: 18 } }, labels)).toThrow()
    expect(() => complete({ ...value, counts: { ...value.counts, snapshots: 33 } }, labels)).toThrow()
    expect(() => complete({ ...value, counts: { ...value.counts, storage: 1 } }, labels)).toThrow()
    expect(() => complete({ ...value, getVerifiedLedger: () => Object.freeze(value.getVerifiedLedger().slice(1)) }, labels)).toThrow()
    expect(() => complete({ ...value, evidence: { ...value.evidence, rawPrivilegeFailures: 0 } }, labels)).toThrow()
    expect(() => complete({ ...value, evidence: { ...value.evidence, restoredPrivilegeContexts: [] } }, labels)).toThrow()
    expect(() => complete({ ...value, completion: () => Object.freeze({ ...value.completion(), complete: false }) }, labels)).toThrow()
  })
})

describe('closed adopter AST/source wiring', () => {
  const source = readFileSync('scripts/check-contextual-test-owner-reorder-lifecycle.ts', 'utf8')
  const tree = ts.createSourceFile('lifecycle.ts', source, ts.ScriptTarget.Latest, true)
  const calls: ts.CallExpression[] = []
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit) }; visit(tree)
  it('constructs one unchanged native engine, original lifecycle and sealed transport, never a second profile', () => {
    for (const name of ['createTestOwnerReorderNativeContracts', 'createTestOwnerReorderProofTransport', 'runAssignmentListEphemeralLifecycle'])
      expect(calls.filter(call => call.expression.getText(tree) === name)).toHaveLength(1)
    expect(calls.filter(call => call.expression.getText(tree) === 'sqlContracts.runCommittedTransitions')).toHaveLength(1)
    expect(source).not.toContain('runTestOwnerReorderConcurrency(')
    expect(source).not.toContain('runTestOwnerReorderDbContracts('); expect(source).not.toContain('installVerifiedLedger')
  })
  it('pins one absolute deadline, exact schema/source/resource/socket guards and source-owned SQL', () => {
    expect(source).toContain('absoluteDeadline = started + APP_CAPS.totalMs')
    expect(source).toContain('absoluteDeadline })'); expect(source).toContain("'253_contextual_test_owner_reorder.sql'")
    expect(source).toContain('union.sql.sourceSha256'); expect(source).toContain('union.sql.migrationManifestSha256')
    expect(source).toContain('validateIntegratedGuardResources'); expect(source).toContain('bindSocket')
    expect(source).toContain('[testOwnerGuardSql(projectId), snapshotSql].includes(sql)')
    expect(source).toContain('testOwnerReorderTableCatalogFromCanonical(captured)')
    expect(source).toContain('validateTestOwnerReorderSetupSnapshot(f, rows, expectedTables)')
    expect(source).toContain('testOwnerReorderMatrixCompletion(f, transport, executed)')
    expect(source).toContain('appBytes + nativeByteReserve + CANONICAL_AFTER_CAPS.bytes + (transport?.counts.exchangeBytes ?? 0) <= APP_CAPS.totalBytes')
    expect(source).toContain('assert.equal(union.sql.capabilities.totalBytes, nativeByteReserve)')
  })
  it('restores the real permission probe through the same engine before rollback contracts and the normal matrix', () => {
    const body = source.slice(source.indexOf('async function matrix()'))
    expect(body.indexOf('probeReorderPrivilegeDrift')).toBeLessThan(body.indexOf('sqlContracts!.run()'))
    expect(body.indexOf('sqlContracts!.run()')).toBeLessThan(body.indexOf('for (const c of f.cases)'))
    expect(body).toContain('rawPrivilegeFailures - raw, 1'); expect(body).toContain("rawCode: '42501' as const")
    expect(body).toContain('exactSnapshotFinally'); expect(body).toContain('remainingSessions, 0')
  })
  it('generates genuine CLI types only after matrix proof, with the actual source/resource guard', () => {
    expect(source).toContain('generateTestDraftSaveTypes({ repository, reviewedHead: input.head, projectId, guard: sdkGuard })')
    expect(source).toContain('input.mode === \'normal\' && complete && matrixComplete && sqlComplete && committedComplete')
    expect(source).not.toContain('database.generated.ts'); expect(source).not.toContain('writeFileSync')
    expect(source).toContain('validateTestOwnerReorderGeneratedTypes(readFileSync(typesReceipt.path')
  })
  it('runs committed changes only after the sealed SDK matrix, without reusing or restoring its ledger', () => {
    const body = source.slice(source.indexOf('async function matrix()'), source.indexOf('\n  try {\n    await runAssignmentListEphemeralLifecycle'))
    const completion = body.indexOf('testOwnerReorderMatrixCompletion(f, transport, executed)')
    const committed = body.indexOf('sqlContracts.runCommittedTransitions()')
    const types = body.indexOf('generateTestDraftSaveTypes(')
    expect(completion).toBeGreaterThan(0); expect(committed).toBeGreaterThan(completion); expect(types).toBeGreaterThan(committed)
    const after = body.slice(committed)
    for (const forbidden of ['runCase(', 'verifyEffects(', 'getVerifiedLedger(', 'exactSnapshotFinally(', 'readContext(', 'verifyTransitionEffects('])
      expect(after).not.toContain(forbidden)
    expect(after).toContain('testOwnerReorderCommittedCompletion'); expect(after).toContain('committedComplete = true')
    expect(source).toContain('assert(complete && matrixComplete && sqlComplete && committedComplete && nativeReceipt && committedReceipt)')
  })
  it('keeps operations import-inert and exports no arbitrary SQL, callbacks or restoration bypass', () => {
    const exported = tree.statements.filter(node => node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
      .map(node => ts.isFunctionDeclaration(node) ? node.name?.text : '')
    expect(exported).not.toContain('verifyPrivilegeRestoration'); expect(exported).not.toContain('exactSnapshotFinally')
    expect(exported).not.toContain('appGuard'); expect(exported).not.toContain('privateSql')
    expect(source).toContain('if (process.argv[1] === fileURLToPath(import.meta.url))')
    expect(source).toContain('complete = true; setupStage = \'complete\'')
  })
  it('guards every ordinary inherited forward and uses the final cumulative native receipt for the sum', () => {
    for (const name of ['executeSql','runCase','runRevocation','verifyRestoration','verifyEphemeral']) {
      const start = source.lastIndexOf(`async ${name}(request)`), end = source.indexOf('\n      },', start)
      const body = source.slice(start, end)
      expect(body.indexOf(`inheritedAdmission('${name}')`)).toBeLessThan(body.indexOf(`await native.${name}(request)`))
      expect(body.indexOf(`await native.${name}(request)`)).toBeLessThan(body.indexOf('check()'))
    }
    expect(source).toContain('testOwnerReorderAccountingReceipt(union, { controls, actions, exchangeBytes: appBytes }, committedReceipt,')
    expect(source).toContain('rollback: nativeReceipt, native: committedReceipt')
    expect(source).toContain('canonicalCleanup.attempts < CANONICAL_AFTER_CAPS.attempts')
    expect(source).toContain('assert.deepEqual(request, canonicalRequest)')
    for (const name of ['inventory','teardown','removeWorkdir']) expect(source).toContain(`inheritedAdmission('${name}', false)`)
    expect(source).toContain('executionStopped = true'); expect(source).toContain('assert(!executionStopped && Date.now() < absoluteDeadline')
  })
})

describe('supplemental committed receipt admission, not native effect acceptance', () => {
  const union = () => testOwnerReorderUnionManifest(original, fixture, 'a'.repeat(40), process.cwd())
  function frozen<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value) } return value }
  function receiptDouble(m: ReturnType<typeof union>) {
    const manifest = m.sql.committed, digest = 'a'.repeat(64)
    const rows = manifest.steps.map(s => ({ label: s.label, outcome: s.outcome, before_sha256: digest, after_sha256: digest,
      cached_sha256: s.chain === 'cached' ? digest : null, actor_id: s.actorId, classroom_id: s.classroomId,
      test_ids: [], count: 0, full_graph_verified: true }))
    return { transitions: { kind: 'committed-test-owner-reorder-transitions', projectId: manifest.projectId, sourceSha256: manifest.sourceSha256,
      manifestSha256: testOwnerDigest(JSON.stringify(manifest)), schedules: manifest.schedules, dispatches: manifest.steps.length,
      bytes: rows.reduce((sum, row) => sum + Buffer.byteLength(JSON.stringify([{ result: row }])), 0), receipts: rows, remainingSessions: 0, elapsedMs: 50, complete: true },
      manifestSha256: testOwnerDigest(JSON.stringify(m.sql)), controls: 200, actions: 100, exchangeBytes: 40000, remainingSessions: 0 }
  }
  it('requires all seven ordered schedules/31 compact effects from the reviewed same-engine manifest', () => {
    const m = union()
    expect(testOwnerReorderCommittedCompletion(m, frozen(receiptDouble(m)))).toEqual({ committedTransitions: 7, committedDispatches: 31,
      legacyMaxResidual: 'demonstrated-not-closed' })
    expect(() => testOwnerReorderCommittedCompletion(m, receiptDouble(m))).toThrow()
  })
  it.each(['manifestSha256', 'remainingSessions', 'controls', 'actions', 'exchangeBytes', 'extra'])('rejects changed outer field %s', field => {
    const m = union(), receipt = receiptDouble(m)
    const bad = field === 'manifestSha256' ? '0'.repeat(64) : field === 'remainingSessions' ? 1 : Number.MAX_SAFE_INTEGER
    expect(() => testOwnerReorderCommittedCompletion(m, frozen({ ...receipt, [field]: bad }))).toThrow()
  })
  it.each(['kind','projectId','sourceSha256','manifestSha256','schedules','dispatches','bytes','receipts','remainingSessions','elapsedMs','complete','extra'])('rejects changed transition field %s', field => {
    const m = union(), receipt = receiptDouble(m)
    const bad = field === 'schedules' ? [...receipt.transitions.schedules].reverse() : field === 'receipts' ? receipt.transitions.receipts.slice(1)
      : field === 'complete' ? false : field === 'remainingSessions' ? 1 : ['kind','projectId','sourceSha256','manifestSha256'].includes(field) ? 'foreign' : Number.MAX_SAFE_INTEGER
    expect(() => testOwnerReorderCommittedCompletion(m, frozen({ ...receipt, transitions: { ...receipt.transitions, [field]: bad } }))).toThrow()
  })
  it.each(['label','outcome','before_sha256','after_sha256','cached_sha256','actor_id','classroom_id','test_ids','count','full_graph_verified','extra'])('rejects altered compact row %s', field => {
    const m = union(), receipt = receiptDouble(m), rows = receipt.transitions.receipts.map(r => ({ ...r }))
    const bad = field === 'test_ids' ? [fixture.tests[0].id, fixture.tests[0].id] : field === 'count' ? 1 : field === 'full_graph_verified' ? false : 'foreign'
    const malformed = rows.map((r, i) => i ? r : { ...r, [field]: bad })
    expect(() => testOwnerReorderCommittedCompletion(m, frozen({ ...receipt, transitions: { ...receipt.transitions, receipts: malformed } }))).toThrow()
  })
  it('rejects reordered or discontinuous effect hashes and missing cached preimages', () => {
    const m = union(), receipt = receiptDouble(m), rows = receipt.transitions.receipts
    for (const altered of [[...rows].reverse(), rows.map((r, i) => i === 1 ? { ...r, before_sha256: 'b'.repeat(64) } : r),
      rows.map(r => r.cached_sha256 ? { ...r, cached_sha256: null } : r)]) {
      expect(() => testOwnerReorderCommittedCompletion(m, frozen({ ...receipt, transitions: { ...receipt.transitions, receipts: altered } }))).toThrow()
    }
  })
  it('rejects understated actual UTF-8 receipts and inner bytes exceeding the same native budget receipt', () => {
    const m = union(), receipt = receiptDouble(m)
    expect(() => testOwnerReorderCommittedCompletion(m, frozen({ ...receipt, transitions: { ...receipt.transitions, bytes: 1 } }))).toThrow()
    expect(() => testOwnerReorderCommittedCompletion(m, frozen({ ...receipt, exchangeBytes: receipt.transitions.bytes - 1 }))).toThrow()
  })
  it('binds each cached apply/denial to its immutable ordered IDs, not just the cached SHA', () => {
    const m = union(), receipt = receiptDouble(m), index = m.sql.committed.steps.findIndex(s => s.chain === 'cached')
    const receipts = receipt.transitions.receipts.map((r, i) => i === index ? { ...r, test_ids: [fixture.tests[0].id], count: 1 } : r)
    const bytes = receipts.reduce((sum, r) => sum + Buffer.byteLength(JSON.stringify([{ result: r }])), 0)
    expect(() => testOwnerReorderCommittedCompletion(m, frozen({ ...receipt, transitions: { ...receipt.transitions, bytes, receipts } }))).toThrow()
    const other = receipt.transitions.receipts.map(r => ({ ...r, test_ids: r.test_ids as string[] }))
    const cacheIndex = m.sql.committed.steps.findIndex(s => s.outcome === 'cached')
    other[cacheIndex] = { ...other[cacheIndex], test_ids: [fixture.tests[0].id, fixture.tests[1].id], count: 2 }
    other[index] = { ...other[index], test_ids: [fixture.tests[1].id, fixture.tests[0].id], count: 2 }
    expect(() => testOwnerReorderCommittedCompletion(m, frozen({ ...receipt, transitions: { ...receipt.transitions, bytes: 30000, receipts: other } }))).toThrow()
  })
})
