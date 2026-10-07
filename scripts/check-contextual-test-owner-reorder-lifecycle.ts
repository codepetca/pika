/** Inert fixed253 adopter. Offline source/AST checks are not native acceptance.
 * Actual execution requires independent review of this exact clean HEAD. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'
import { newAssignmentListProofFixture, assignmentListFixtureSetupSql } from './contextual-assignment-list-proof-fixture'
import { AssignmentListLifecycleError, runAssignmentListEphemeralLifecycle, type AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'
import { createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations, assignmentListExpectedResources,
  assignmentListRestorationPolicy, assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { draftSaveProofDockerInventory } from './contextual-test-draft-save-proof-inventory'
import { draftSaveMigrationManifestSha256 } from './check-contextual-test-draft-save-db-contracts'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { TEST_OWNER_REORDER_CAPS, TEST_OWNER_REORDER_SNAPSHOT_TABLES,
  newTestOwnerReorderFixture, testOwnerReorderSetupSql, testOwnerReorderSnapshotSql, testOwnerReorderRequest,
  testOwnerReorderTableCatalogFromCanonical, validateTestOwnerReorderSetupSnapshot, type TestOwnerReorderFixture } from './contextual-test-reorder-proof-fixture'
import { createTestOwnerReorderProofTransport, testOwnerReorderRequestManifest } from './contextual-test-reorder-proof-transport'
import { buildTestOwnerReorderNativeContractsManifest, createTestOwnerReorderNativeContracts } from './contextual-test-draft-save-native-contracts'
import { generateTestDraftSaveTypes } from './generate-contextual-test-draft-save-types'

const cleanupMarker = 'PASS isolated test-owner-reorder exact teardown and unchanged canonical baseline.\n'
// Feature-owned proof accounting; parent engine and product limits are unchanged.
const APP_CAPS = Object.freeze({ controls: 4000, actions: 200, totalMs: 900000, controlMs: 45000, totalBytes: 384 * 1024 * 1024 })
// One receipt-sized allowance inside384MiB, not an execution-clock renewal.
// The unchanged platform canonical adapter owns finite internal command bounds.
const CANONICAL_AFTER_CAPS = Object.freeze({ attempts: 1, bytes: 8 * 1024 * 1024 })
type Rows = Record<string, Array<Record<string, unknown>>>
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) } return value }

export function testOwnerReorderUnionManifest(original: ReturnType<typeof newAssignmentListProofFixture>, fixture: TestOwnerReorderFixture,
  reviewedHead: string, repository: string) {
  const sql = buildTestOwnerReorderNativeContractsManifest(original, fixture, reviewedHead, repository)
  const project = `pika_assignment_list_${fixture.tag.slice(-12)}`
  const cases = [...fixture.privilegeProbes, ...fixture.cases]
  const inheritedCases = original.manifest.cases.length, revocations = assignmentListRevocationPlans(original).length
  assert(fixture.cases.findIndex(c => c.label === 'teacher-owner') < fixture.cases.findIndex(c => c.label === 'teacher-noop'))
  return freeze({ version: 1, reviewedHead, originalSha256: testOwnerDigest(JSON.stringify(original.manifest)),
    application: testOwnerReorderRequestManifest(fixture), sql,
    applicationSetupSha256: testOwnerDigest(testOwnerReorderSetupSql(fixture, project)),
    applicationSnapshotSha256: testOwnerDigest(testOwnerReorderSnapshotSql(fixture)), applicationCapabilities: APP_CAPS,
    canonicalAfterCapabilities: CANONICAL_AFTER_CAPS,
    // Each revocation has its loop session plus scoped revoke/restore sessions.
    inheritedLifecycleCapabilities: { canonicalSnapshot: 2, inventory: 8 + inheritedCases + 3 * revocations, prepare: 1, command: 2,
      verifyEphemeral: 1 + inheritedCases + 3 * revocations, executeSql: 1 + 2 * revocations, runCase: inheritedCases,
      runRevocation: revocations, verifyRestoration: revocations, teardown: 1, removeWorkdir: 1 },
    inventory: { ...fixture.inventory, sdkCases: fixture.cases.length, sdkReorders: fixture.cases.filter(c => c.expectedHTTP === 200).length,
      privilegeDriftProbes: fixture.privilegeProbes.length, rpcRequests: cases.reduce((n, c) => n + c.expectedRPCs, 0),
      storageRequests: 0, rollbackSchedules: sql.concurrency.schedules.length, committedTransitions: sql.committed.schedules.length },
    remainingGates: ['Successful Blueprint/proposal workflow', 'Enabled purge workflow activation'] })
}

/** Pure receipt accounting. Opaque inherited/CLI internals are deliberately not
 * represented as SQL dispatches or measured exchanges. */
export function testOwnerReorderAccountingReceipt(union: ReturnType<typeof testOwnerReorderUnionManifest>,
  application: { controls: number; actions: number; exchangeBytes: number }, nativeCumulativeAtCommitted: { controls: number; actions: number; exchangeBytes: number },
  sdkExchangeBytes: number, cleanup: { attempts: number; bytes: number }, inheritedCalls: Record<string, number>) {
  const integer = (n: number, max: number) => assert(Number.isSafeInteger(n) && n >= 0 && n <= max)
  integer(application.controls, APP_CAPS.controls); integer(application.actions, APP_CAPS.actions); integer(application.exchangeBytes, APP_CAPS.totalBytes)
  integer(nativeCumulativeAtCommitted.controls, union.sql.capabilities.controlCalls); integer(nativeCumulativeAtCommitted.actions, union.sql.capabilities.actions)
  integer(nativeCumulativeAtCommitted.exchangeBytes, union.sql.capabilities.totalBytes); integer(sdkExchangeBytes, TEST_OWNER_REORDER_CAPS.totalBytes)
  assert.equal(cleanup.attempts, CANONICAL_AFTER_CAPS.attempts); integer(cleanup.bytes, CANONICAL_AFTER_CAPS.bytes)
  assert.deepEqual(Object.keys(inheritedCalls).sort(), Object.keys(union.inheritedLifecycleCapabilities).sort())
  for (const [name, cap] of Object.entries(union.inheritedLifecycleCapabilities)) integer(inheritedCalls[name], cap)
  const sum = application.actions + nativeCumulativeAtCommitted.actions, sumCeiling = APP_CAPS.actions + union.sql.capabilities.actions
  integer(sum, sumCeiling)
  const accountedUpperBoundBytes = application.exchangeBytes + cleanup.bytes + sdkExchangeBytes + union.sql.capabilities.totalBytes
  integer(accountedUpperBoundBytes, APP_CAPS.totalBytes)
  return freeze({ countedActions: { application: application.actions, nativeCumulativeAtCommitted: nativeCumulativeAtCommitted.actions, sum,
    applicationCeiling: APP_CAPS.actions, nativeCeiling: union.sql.capabilities.actions, sumCeiling },
    nativeAccountingScope: 'cumulative-through-committed-stage; subsequent guards remain inside reserved native budget',
    exchange: { application: application.exchangeBytes, canonicalAfter: cleanup.bytes, reservedCanonicalAfter: CANONICAL_AFTER_CAPS.bytes,
      reservedNative: union.sql.capabilities.totalBytes, nativeMeasuredAtCommitted: nativeCumulativeAtCommitted.exchangeBytes,
      sdk: sdkExchangeBytes, accountedUpperBoundBytes, ceiling: APP_CAPS.totalBytes,
      excludes: ['opaque inherited adapter IO', 'opaque type-generator CLI IO'] },
    inherited: { calls: { ...inheritedCalls }, ceilings: union.inheritedLifecycleCapabilities, scope: 'adapter-calls-not-internal-SQL-or-bytes' } })
}

/** Structural checks supplement the fixture's complete first-baseline/effect
 * validators. The actual caller obtains the catalog from the native receipt. */
export function validateTestOwnerReorderSnapshotCatalog(value: unknown, expectedTables: readonly string[]): Rows {
  assert(Object.isFrozen(expectedTables) && expectedTables.length > 0 && expectedTables.length <= TEST_OWNER_REORDER_CAPS.fingerprintTables)
  assert.equal(new Set(expectedTables).size, expectedTables.length)
  assert(boundedAssignmentListJson(value, TEST_OWNER_REORDER_CAPS.snapshotBytes))
  const rows = z.record(z.string(), z.array(z.record(z.string(), z.unknown())).max(TEST_OWNER_REORDER_CAPS.bulkProjectionRows)).parse(value)
  assert.deepEqual(Object.keys(rows).sort(), [...TEST_OWNER_REORDER_SNAPSHOT_TABLES, '__bulk_tests', '__bulk_setup', '__nontarget_fingerprints'].sort())
  for (const table of TEST_OWNER_REORDER_SNAPSHOT_TABLES) assert(rows[table].length <= TEST_OWNER_REORDER_CAPS.rowsPerTable)
  assert(Object.values(rows).reduce((sum, r) => sum + r.length, 0) <= TEST_OWNER_REORDER_CAPS.snapshotRows)
  const fingerprints = z.array(z.object({ table: z.string().regex(/^(public|private|storage)\.[a-z_0-9]+$/), fingerprint: z.string().min(1).max(4096) }).strict())
    .max(TEST_OWNER_REORDER_CAPS.fingerprintTables).parse(rows.__nontarget_fingerprints)
  assert.equal(new Set(fingerprints.map(r => r.table)).size, fingerprints.length)
  assert.deepEqual(fingerprints.map(r => r.table).sort(), [...expectedTables], 'Complete canonical table catalog differs')
  return rows
}

// Private closed orchestration only: no exported probe/restoration callbacks.
async function exactSnapshotFinally<T>(before: Rows, snapshot: () => Promise<Rows>, operation: () => Promise<T>) {
  let primary: unknown; let failed = false; let receipt: T | undefined
  try { receipt = await operation() } catch (error) { failed = true; primary = error }
  try { assert.deepEqual(await snapshot(), before, 'Application restoration/rollback rows changed') }
  catch (error) { if (failed) throw new AggregateError([primary, error], 'Private reorder final snapshot failed'); throw error }
  if (failed) throw primary
  return receipt!
}

export function testOwnerReorderMatrixCompletion(f: TestOwnerReorderFixture,
  transport: ReturnType<typeof createTestOwnerReorderProofTransport>, executed: readonly string[]) {
  const cases = [...f.privilegeProbes, ...f.cases]; const labels = cases.map(c => c.label)
  assert.deepEqual(executed, labels)
  const ledger = transport.getVerifiedLedger(); assert(Object.isFrozen(ledger) && ledger.length === labels.length)
  assert.deepEqual(ledger.map(w => ({ kind: w.kind, caseLabel: w.caseLabel, state: w.state })),
    cases.map(c => ({ kind: c.expectedHTTP === 200 ? 'reorder' : 'denial', caseLabel: c.label, state: 'verified' })))
  const requests = cases.reduce((n, c) => n + c.expectedRPCs, 0)
  assert.equal(transport.counts.rpc, requests); assert.equal(transport.counts.network, requests); assert.equal(transport.counts.storage, 0)
  assert.equal(transport.counts.snapshots, 2 * labels.length); assert.equal(transport.evidence.rawPrivilegeFailures, f.privilegeProbes.length)
  assert.deepEqual(transport.evidence.rawPrivilegeContexts, f.privilegeProbes.map(c => c.context).sort())
  assert.deepEqual(transport.evidence.restoredPrivilegeContexts, f.privilegeProbes.map(c => c.context).sort())
  const completion = transport.completion(); assert(Object.isFrozen(completion) && completion.complete)
  assert.deepEqual(completion.verifiedContextLabels, executed)
  return freeze({ sdkCases: f.cases.length, sdkReorders: f.cases.filter(c => c.expectedHTTP === 200).length,
    rpcRequests: requests, storageRequests: 0, verifiedEffects: ledger.length })
}

/** Supplemental finite receipt admission. The closed native SQL runner owns
 * whole-catalog full-row effect verification; this never promotes an SDK ledger. */
export function testOwnerReorderCommittedCompletion(union: ReturnType<typeof testOwnerReorderUnionManifest>, value: unknown) {
  assert(value && typeof value === 'object' && Object.isFrozen(value))
  assert(boundedAssignmentListJson(value, TEST_OWNER_REORDER_CAPS.snapshotBytes))
  const m = union.sql.committed, caps = union.sql.capabilities
  assert(Object.isFrozen(m) && m.schedules.length === m.caps.schedules && m.steps.length === m.caps.dispatches)
  assert.equal(m.sourceSha256, union.sql.sourceSha256)
  const digest = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/)
  const row = z.object({ label: z.string().min(1).max(128), outcome: z.string().min(1).max(64), before_sha256: digest,
    after_sha256: digest, cached_sha256: digest.nullable(), actor_id: uuid, classroom_id: uuid,
    test_ids: z.array(uuid).max(TEST_OWNER_REORDER_CAPS.maxTestIds), count: z.number().int().min(0).max(TEST_OWNER_REORDER_CAPS.maxTestIds),
    full_graph_verified: z.literal(true) }).strict()
  const receipt = z.object({ transitions: z.object({ kind: z.literal('committed-test-owner-reorder-transitions'), projectId: z.literal(m.projectId),
    sourceSha256: z.literal(m.sourceSha256), manifestSha256: z.literal(testOwnerDigest(JSON.stringify(m))),
    schedules: z.array(z.string()).length(m.schedules.length), dispatches: z.literal(m.steps.length),
    bytes: z.number().int().min(1).max(m.caps.totalBytes), receipts: z.array(row).length(m.steps.length), remainingSessions: z.literal(0),
    elapsedMs: z.number().int().min(0).max(APP_CAPS.totalMs), complete: z.literal(true) }).strict(),
    manifestSha256: z.literal(testOwnerDigest(JSON.stringify(union.sql))), controls: z.number().int().min(1).max(caps.controlCalls),
    actions: z.number().int().min(m.steps.length).max(caps.actions), exchangeBytes: z.number().int().min(1).max(caps.totalBytes),
    remainingSessions: z.literal(0) }).strict().parse(value)
  assert.deepEqual(receipt.transitions.schedules, m.schedules)
  assert(receipt.transitions.bytes <= receipt.exchangeBytes)
  const caches = new Map<string, Readonly<{ sha256: string; ids: readonly string[] }>>(); let prior: string | undefined, measuredBytes = 0
  for (const [index, r] of receipt.transitions.receipts.entries()) {
    const step = m.steps[index]
    const bytes = Buffer.byteLength(JSON.stringify([{ result: r }]))
    assert(bytes <= m.caps.responseBytes); measuredBytes += bytes
    assert.deepEqual({ label: r.label, outcome: r.outcome, actorId: r.actor_id, classroomId: r.classroom_id },
      { label: step.label, outcome: step.outcome, actorId: step.actorId, classroomId: step.classroomId })
    assert.equal(r.count, r.test_ids.length); assert.equal(new Set(r.test_ids).size, r.test_ids.length)
    if (prior !== undefined) assert.equal(r.before_sha256, prior)
    const key = `${step.label.split(':')[0]}:${step.side}`
    if (step.outcome === 'cached') { assert.equal(r.cached_sha256, null); caches.set(key, freeze({ sha256: r.before_sha256, ids: [...r.test_ids] })) }
    else if (step.chain === 'cached') {
      const cached = caches.get(key); assert(cached)
      assert.equal(r.cached_sha256, cached.sha256); assert.deepEqual(r.test_ids, cached.ids)
    }
    else assert.equal(r.cached_sha256, null)
    if (step.chain === 'same' || /^PT/.test(step.outcome)) assert.equal(r.after_sha256, r.before_sha256)
    prior = r.after_sha256
  }
  assert(measuredBytes <= receipt.transitions.bytes)
  return freeze({ committedTransitions: m.schedules.length, committedDispatches: receipt.transitions.dispatches,
    legacyMaxResidual: 'demonstrated-not-closed' as const })
}

export function testOwnerReorderSetupDiagnostic(stage: unknown, error: unknown) {
  const allowed = ['pending', 'app-guard', 'app-write', 'app-snapshot', 'app-verify', 'sql-prepare', 'sql-setup', 'complete']
  const setup = typeof stage === 'string' && allowed.includes(stage) ? stage : 'unknown'
  const lifecycle = error instanceof AssignmentListLifecycleError ? error : undefined
  const phases = ['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'after-fixture', 'before-capture']
  const phase = phases.includes(lifecycle?.primary?.stage ?? '') ? lifecycle!.primary!.stage : 'unknown'
  const cause = lifecycle ? lifecycle.primary?.error : error
  return `DIAG test-owner-reorder setup=${setup} lifecycle=${phase} cleanup=${lifecycle ? lifecycle.cleanupFailures.length ? 'present' : 'none' : 'unknown'} failure=${cause instanceof assert.AssertionError ? 'assertion' : 'unknown'}.\n`
}
export function parseTestOwnerReorderLifecycleArgs(args: string[]) {
  const generateTypes = args.length === 5 && args[4] === '--generate-types'
  const input = parseAssignmentListLifecycleArgs(generateTypes ? args.slice(0, 4) : args)
  assert(!generateTypes || input.mode === 'normal'); return { ...input, generateTypes }
}
export function testOwnerReorderForcedReceipt(mode: string, error: unknown, complete: boolean) {
  if (complete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError
    && error.primary?.stage === mode && error.primary.error instanceof Error
    && error.primary.error.message === 'Forced isolated lifecycle failure' && error.cleanupFailures.length === 0) {
    return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-owner-reorder lifecycle: ${mode}.\n`, exitCode: 1 }
  }
  return null
}

/** AST shape checking supplements genuine CLI provenance and never writes an
 * overlay or generated contract. */
export function validateTestOwnerReorderGeneratedTypes(source: string, expectedSha256: string) {
  assert(Buffer.byteLength(source) <= TEST_OWNER_REORDER_CAPS.snapshotBytes); assert.equal(testOwnerDigest(source), expectedSha256)
  const syntax = ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext } })
  assert(!syntax.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error))
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = tree.statements.filter(ts.isTypeAliasDeclaration).filter(n => n.name.text === 'Database'); assert.equal(declarations.length, 1)
  assert(declarations[0].modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
  function field(node: ts.TypeNode, name: string): ts.TypeNode {
    assert(ts.isTypeLiteralNode(node)); const found = node.members.filter(ts.isPropertySignature).filter(m => m.name.getText(tree) === name)
    assert.equal(found.length, 1); assert(!found[0].questionToken && found[0].type); return found[0].type
  }
  const declaration = field(field(field(declarations[0].type, 'public'), 'Functions'), 'reorder_tests_for_owner_v1')
  assert(ts.isTypeLiteralNode(declaration)); assert.deepEqual(declaration.members.map(m => m.name?.getText(tree)).sort(), ['Args', 'Returns'])
  const args = field(declaration, 'Args'); assert(ts.isTypeLiteralNode(args))
  assert.deepEqual(args.members.map(m => m.name?.getText(tree)).sort(), ['p_actor_id', 'p_classroom_id', 'p_deadline', 'p_test_ids'])
  for (const arg of args.members) {
    assert(ts.isPropertySignature(arg) && !arg.questionToken && arg.type)
    if (arg.name.getText(tree) === 'p_test_ids') assert(ts.isArrayTypeNode(arg.type) && arg.type.elementType.kind === ts.SyntaxKind.StringKeyword)
    else assert.equal(arg.type.kind, ts.SyntaxKind.StringKeyword)
  }
  const returns = field(declaration, 'Returns'); assert(ts.isTypeReferenceNode(returns) && returns.typeName.getText(tree) === 'Json' && !returns.typeArguments)
  return true
}

export async function testOwnerReorderLifecycleMain(args = process.argv.slice(2)) {
  const input = parseTestOwnerReorderLifecycleArgs(args)
  const started = Date.now(), absoluteDeadline = started + APP_CAPS.totalMs
  let controls = 0, actions = 0, appBytes = 0
  let executionStopped = false
  const canonicalCleanup = { attempts: 0, bytes: 0 }
  let transport: ReturnType<typeof createTestOwnerReorderProofTransport> | undefined
  // The closed native engine owns its private counters. Reserve its unchanged
  // complete64MiB budget throughout, including restoration and later guards.
  const nativeByteReserve = 64 * 1024 * 1024
  function check() {
    try {
      assert(!executionStopped && Date.now() < absoluteDeadline && controls <= APP_CAPS.controls && actions <= APP_CAPS.actions)
      assert(appBytes + nativeByteReserve + CANONICAL_AFTER_CAPS.bytes + (transport?.counts.exchangeBytes ?? 0) <= APP_CAPS.totalBytes)
    } catch (error) { executionStopped = true; throw error }
  }
  function account(text: string, limit = TEST_OWNER_REORDER_CAPS.snapshotBytes) {
    const bytes = Buffer.byteLength(text); assert(bytes <= limit); appBytes += bytes; check()
  }
  const git = (args: string[]) => {
    check(); assert(++controls <= APP_CAPS.controls)
    const output = execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(10000, absoluteDeadline - Date.now()), maxBuffer: TEST_OWNER_REORDER_CAPS.snapshotBytes })
    account(output); return output.trim()
  }
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '')
  const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const migrations = loadAssignmentListReviewedMigrations(repository)
  assert.equal(migrations.length, 253); assert.equal(migrations.at(-1)?.name, '253_contextual_test_owner_reorder.sql')
  const original = newAssignmentListProofFixture(), f = newTestOwnerReorderFixture(original), projectId = `pika_assignment_list_${f.tag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(original), originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testOwnerReorderSetupSql(f, projectId), snapshotSql = testOwnerReorderSnapshotSql(f), union = testOwnerReorderUnionManifest(original, f, input.head, repository)
  assert.equal(union.sql.capabilities.totalBytes, nativeByteReserve)
  const unionSha256 = testOwnerDigest(JSON.stringify(union))
  let target: ReturnType<typeof validateAssignmentListProofTarget> | undefined, session: Session | undefined
  let closure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined, expectedTables: readonly string[] | undefined, canonicalSha256: string | undefined
  let canonicalRequest: Parameters<AssignmentListLifecycleAdapters['canonicalSnapshot']>[0] | undefined
  const inheritedCalls = { canonicalSnapshot: 0, inventory: 0, prepare: 0, command: 0, verifyEphemeral: 0, executeSql: 0,
    runCase: 0, runRevocation: 0, verifyRestoration: 0, teardown: 0, removeWorkdir: 0 }
  function inheritedAdmission(name: keyof typeof inheritedCalls, ordinary = true) {
    if (ordinary) check()
    assert(inheritedCalls[name] < union.inheritedLifecycleCapabilities[name]); inheritedCalls[name]++
  }
  let client: ReturnType<typeof createClient<Database>> | undefined
  let sqlContracts: ReturnType<typeof createTestOwnerReorderNativeContracts> | undefined, nativeReceipt: Awaited<ReturnType<NonNullable<typeof sqlContracts>['run']>> | undefined
  let committedReceipt: Awaited<ReturnType<NonNullable<typeof sqlContracts>['runCommittedTransitions']>> | undefined
  let complete = false, matrixComplete = false, sqlComplete = false, committedComplete = false, setupStage = 'pending'
  let typesReceipt: Awaited<ReturnType<typeof generateTestDraftSaveTypes>> | undefined
  let socket: { host: string; identity: Array<number | bigint> } | undefined
  const originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  const bindSocket = ((path: Parameters<typeof statSync>[0]) => {
    check(); assert(++controls <= APP_CAPS.controls); assert(typeof path === 'string' && isAbsolute(path) && normalize(path) === path)
    const observed = statSync(path); assert(observed.isSocket())
    const bound = { host: `unix://${path}`, identity: [observed.dev, observed.ino, observed.mode, observed.rdev] }
    if (socket) assert.deepEqual(bound, socket); else socket = bound
    return observed
  }) as typeof statSync
  function privateSql(sql: string) {
    check(); assert(session && socket && [testOwnerGuardSql(projectId), snapshotSql].includes(sql)); assert(++actions <= APP_CAPS.actions)
    account(sql, TEST_OWNER_REORDER_CAPS.sqlBytes)
    const output = execFileSync('docker', ['--host', socket.host, 'exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, session.containerId,
      'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      timeout: Math.min(APP_CAPS.controlMs, absoluteDeadline - Date.now()), maxBuffer: TEST_OWNER_REORDER_CAPS.snapshotBytes })
    account(output); check(); return output.trim()
  }
  async function appGuard() {
    check(); assert(target && session); assert(++controls <= APP_CAPS.controls)
    assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['rev-parse', '--show-toplevel']), repository)
    assert.equal(git(['status', '--porcelain', '--untracked-files=all']), '')
    assert.equal(draftSaveMigrationManifestSha256(repository), union.sql.migrationManifestSha256)
    assert.equal(testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/253_contextual_test_owner_reorder.sql'), 'utf8')), union.sql.sourceSha256)
    closure = validateIntegratedGuardResources(await draftSaveProofDockerInventory({ stat: bindSocket }), projectId, session.containerId, closure)
    account(JSON.stringify(closure)); assert.equal(privateSql(testOwnerGuardSql(projectId)), 'ok'); check()
  }
  async function sdkGuard() { await appGuard(); assert(sqlContracts); await sqlContracts.verifyTarget(); check() }
  async function snapshot(): Promise<Rows> {
    assert(expectedTables && testOwnerDigest(snapshotSql) === union.applicationSnapshotSha256)
    await appGuard(); return validateTestOwnerReorderSnapshotCatalog(JSON.parse(privateSql(snapshotSql)), expectedTables)
  }
  async function setup() {
    setupStage = 'app-guard'; assert.equal(testOwnerDigest(setupSql), union.applicationSetupSha256); await appGuard(); assert(session)
    setupStage = 'app-write'; assert(++actions <= APP_CAPS.actions); account(setupSql, TEST_OWNER_REORDER_CAPS.sqlBytes)
    await native.executeSql({ ...session, sql: setupSql }); check()
    setupStage = 'app-snapshot'; const rows = await snapshot()
    setupStage = 'app-verify'; assert(expectedTables); validateTestOwnerReorderSetupSnapshot(f, rows, expectedTables); assert(closure)
    assert.equal(testOwnerDigest(JSON.stringify(union)), unionSha256); setupStage = 'sql-prepare'
    sqlContracts = createTestOwnerReorderNativeContracts({ repository, reviewedHead: input.head, original, fixture: f, capturedResources: closure,
      containerId: session.containerId, acceptedManifestSha256: testOwnerDigest(JSON.stringify(union.sql)), absoluteDeadline })
    setupStage = 'sql-setup'; const receipt = await sqlContracts.setup()
    assert.equal(receipt.fixtureSha256, testOwnerDigest(JSON.stringify(f))); assert.equal(receipt.setupSha256, testOwnerDigest(union.sql.setup))
    complete = true; setupStage = 'complete'
  }
  async function matrix() {
    assert(complete && !matrixComplete && client && transport && sqlContracts)
    const { reorderContextualTests } = await import('../src/lib/server/contextual-test-reorder')
    const executed: string[] = []
    async function runCase(c: (typeof f.cases)[number] | (typeof f.privilegeProbes)[number]) {
      const before = await snapshot(), count = transport!.counts.rpc, startTime = Date.now()
      transport!.readContext(c.label, startTime)
      const reorder = () => reorderContextualTests({ supabase: client!, actorId: c.actorId, input: testOwnerReorderRequest(f, c.label), deadline: startTime + 20000 })
      let result: unknown
      if (c.expectedHTTP === 200) result = await reorder()
      else await assert.rejects(reorder, error => error instanceof ApiError && error.statusCode === c.expectedHTTP)
      assert.equal(transport!.counts.rpc - count, c.expectedRPCs)
      transport!.verifyEffects(before, await snapshot(), result); executed.push(c.label); check()
    }
    for (const c of f.privilegeProbes) {
      const beforePrivilege = await snapshot()
      const receipt = await exactSnapshotFinally(beforePrivilege, snapshot, () => sqlContracts!.probeReorderPrivilegeDrift(async () => {
        const count = transport!.counts.rpc, raw = transport!.evidence.rawPrivilegeFailures
        await runCase(c); assert.equal(transport!.counts.rpc - count, c.expectedRPCs)
        assert.equal(transport!.evidence.rawPrivilegeFailures - raw, 1); assert(transport!.evidence.rawPrivilegeContexts.includes(c.context))
        return { status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }
      }))
      assert(receipt.privilegeRestored && receipt.fixtureUnchanged); assert.match(receipt.snapshotAclSha256, /^[a-f0-9]{64}$/)
    }
    const preSdkBaseline = freeze(structuredClone(await snapshot()))
    nativeReceipt = await exactSnapshotFinally(preSdkBaseline, snapshot, async () => {
      const receipt = await sqlContracts!.run(); assert(receipt.fixtureUnchanged); assert.equal(receipt.remainingSessions, 0)
      assert.equal(receipt.manifestSha256, testOwnerDigest(JSON.stringify(union.sql))); return receipt
    })
    sqlComplete = true
    for (const c of f.cases) await runCase(c)
    testOwnerReorderMatrixCompletion(f, transport, executed); matrixComplete = true
    // The initial private SDK ledger is complete and is never consulted again
    // after committed changes. No compensation, baseline restore or new engine.
    await sdkGuard(); committedReceipt = await sqlContracts.runCommittedTransitions(); check()
    testOwnerReorderCommittedCompletion(union, committedReceipt); committedComplete = true
    if (input.generateTypes) {
      assert(input.mode === 'normal' && complete && matrixComplete && sqlComplete && committedComplete)
      check()
      typesReceipt = await generateTestDraftSaveTypes({ repository, reviewedHead: input.head, projectId, guard: sdkGuard })
      check()
      assert.equal(typesReceipt.migrationManifestSha256, union.sql.migrationManifestSha256)
      validateTestOwnerReorderGeneratedTypes(readFileSync(typesReceipt.path, 'utf8'), typesReceipt.sha256)
    }
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations, mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
      restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) }, {
      ...native,
      async canonicalSnapshot(request) {
        assert.deepEqual(request, { projectId: 'pika', dbPort: 54322, applicationName: `${projectId}_canonical_readonly`, readOnly: true })
        const after = canonicalRequest !== undefined
        if (after) {
          assert.deepEqual(request, canonicalRequest); assert(expectedTables && canonicalSha256)
          assert(canonicalCleanup.attempts < CANONICAL_AFTER_CAPS.attempts); canonicalCleanup.attempts++
          executionStopped = true
        } else { check(); assert(++controls <= APP_CAPS.controls); canonicalRequest = freeze(structuredClone(request)) }
        inheritedAdmission('canonicalSnapshot', false)
        const captured = await native.canonicalSnapshot(request), catalog = testOwnerReorderTableCatalogFromCanonical(captured)
        assert.deepEqual(Object.keys(captured).sort(), ['rowDigests','guard168Metadata','settings','cronJobs','resources'].sort())
        for (const field of Object.values(captured)) assert(typeof field === 'string' && field.length > 0)
        if (after) { canonicalCleanup.bytes = Buffer.byteLength(JSON.stringify(captured)); assert(canonicalCleanup.bytes <= CANONICAL_AFTER_CAPS.bytes) }
        else account(JSON.stringify(captured))
        if (expectedTables) assert.deepEqual(catalog, expectedTables); else { expectedTables = catalog; canonicalSha256 = testOwnerDigest(JSON.stringify(captured)) }
        return captured
      },
      async inventory(request) {
        inheritedAdmission('inventory', false)
        assert.equal(request.projectId, projectId); assert.equal(request.workdir, assignmentListProofWorkdir(projectId))
        return native.inventory(request)
      },
      async prepare(request, sourceMigrations) {
        inheritedAdmission('prepare'); const receipt = await native.prepare(request, sourceMigrations)
        // Return ownership evidence even on exhaustion so the parent records the
        // exact created workdir before its next ordinary admission fails.
        try { check() } catch { /* Sticky stop; no subsequent execution resumes. */ }
        return receipt
      },
      async command(request) {
        inheritedAdmission('command'); assert(++controls <= APP_CAPS.controls)
        const result = await native.command({ ...request, timeoutMs: Math.min(request.timeoutMs, absoluteDeadline - Date.now()) })
        if (result !== undefined) account(JSON.stringify(result)); check()
        if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result
      },
      async verifyEphemeral(request) {
        inheritedAdmission('verifyEphemeral'); const result = await native.verifyEphemeral(request); check(); return result
      },
      async executeSql(request) {
        inheritedAdmission('executeSql'); await native.executeSql(request); check()
        if (request.sql === originalSetup) {
          assert(!session && target && expectedTables); session = { ...request }
          transport = createTestOwnerReorderProofTransport(f, target, projectId, fetch, sdkGuard)
          client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
          await setup()
        }
      },
      async runCase(request) {
        inheritedAdmission('runCase'); const result = await native.runCase(request); check()
        if (!matrixComplete) await matrix(); check(); return result
      },
      async runRevocation(request) {
        inheritedAdmission('runRevocation'); const result = await native.runRevocation(request); check(); return result
      },
      async verifyRestoration(request) {
        inheritedAdmission('verifyRestoration'); const result = await native.verifyRestoration(request); check(); return result
      },
      async teardown(request) { inheritedAdmission('teardown', false); return native.teardown(request) },
      async removeWorkdir(request) { inheritedAdmission('removeWorkdir', false); return native.removeWorkdir(request) },
    })
    assert(complete && matrixComplete && sqlComplete && committedComplete && nativeReceipt && committedReceipt)
    const accounting = testOwnerReorderAccountingReceipt(union, { controls, actions, exchangeBytes: appBytes }, committedReceipt,
      transport!.counts.exchangeBytes, canonicalCleanup, inheritedCalls)
    process.stdout.write(`PASS isolated test-owner-reorder ${f.cases.length} installed-SDK helper cases; ${union.inventory.sdkReorders} full-effect reorders; restored raw42501; nine rollback SQL batches and ${union.inventory.rollbackSchedules} held-lock schedules (declined Blueprint114 and bidirectional purge-guard122); ${union.inventory.committedTransitions} committed schedules. Legacy cached MAX residual demonstrated, not closed. Remaining: successful Blueprint/proposal and enabled purge workflow activation.\n${cleanupMarker}`)
    return freeze({ types: typesReceipt ?? null, proof: { reviewedHead: input.head, manifestSha256: unionSha256, canonicalSha256,
      tableCatalogSha256: testOwnerDigest(JSON.stringify(expectedTables)), sdkCases: f.cases.length, sdkReorders: union.inventory.sdkReorders,
      rollbackSchedules: union.inventory.rollbackSchedules, committedTransitions: union.inventory.committedTransitions,
      legacyMaxResidual: 'demonstrated-not-closed', rpcRequests: transport!.counts.rpc, storageRequests: transport!.counts.storage, exchangeBytes: transport!.counts.exchangeBytes,
      snapshotBytes: transport!.counts.snapshotBytes, rollback: nativeReceipt, native: committedReceipt, committed: committedReceipt, accounting,
      application: { controls, actions, exchangeBytes: appBytes,
        reservedNativeBytes: nativeByteReserve, sdkExchangeBytes: transport!.counts.exchangeBytes,
        canonicalAfter: canonicalCleanup, accountedUpperBoundBytes: accounting.exchange.accountedUpperBoundBytes },
      remainingGates: union.remainingGates } })
  } catch (error) {
    const forced = testOwnerReorderForcedReceipt(input.mode, error, complete)
    if (forced) { process.stdout.write(forced.stdout); process.stderr.write(forced.stderr); process.exitCode = forced.exitCode; return }
    process.stderr.write(testOwnerReorderSetupDiagnostic(setupStage, error))
    if (sqlContracts) process.stderr.write(sqlContracts.diagnostic()); if (transport) process.stderr.write(transport.diagnostic())
    throw Error('Test owner reorder lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerReorderLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-reorder lifecycle; private details withheld.\n'); process.exitCode = 1
})
