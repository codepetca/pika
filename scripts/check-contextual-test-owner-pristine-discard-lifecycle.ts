/** Inert finite pristine DELETE SDK/lifecycle source. Only reviewed invocation may
 * use the original exact-project platform and unchanged full-schema generator. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { ApiError } from '../src/lib/api-error'
import { boundedAssignmentListJson } from '../src/lib/validations/contextual-assignment-list-read'
import { newAssignmentListProofFixture, assignmentListFixtureSetupSql } from './contextual-assignment-list-proof-fixture'
import { runAssignmentListEphemeralLifecycle, AssignmentListLifecycleError, type AssignmentListLifecycleAdapters } from './contextual-assignment-list-proof-lifecycle'
import { createAssignmentListNativeAdapters, loadAssignmentListReviewedMigrations, assignmentListExpectedResources,
  assignmentListRestorationPolicy, assignmentListDockerInventory } from './contextual-assignment-list-proof-platform'
import { assignmentListRevocationPlans } from './contextual-assignment-list-proof-revocations'
import { assignmentListProofWorkdir } from './contextual-assignment-list-proof-path'
import { validateAssignmentListProofTarget } from './check-contextual-assignment-list-reads'
import { parseAssignmentListLifecycleArgs } from './check-contextual-assignment-list-lifecycle'
import { validateIntegratedGuardResources } from './check-contextual-assignment-learner-integrated-lifecycle'
import { draftSaveProofDockerInventory } from './contextual-test-draft-save-proof-inventory'
import { draftSaveMigrationManifestSha256 } from './check-contextual-test-draft-save-db-contracts'
import { testOwnerDigest, testOwnerGuardSql } from './contextual-test-owner-detail-proof-fixture'
import { newTestOwnerPristineDiscardFixture, testOwnerPristineDiscardSetupSql, testOwnerPristineDiscardSnapshotSql,
  validateTestOwnerPristineDiscardSetupSnapshot, TEST_OWNER_PRISTINE_DISCARD_CAPS, TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES,
  type TestOwnerPristineDiscardFixture } from './contextual-test-pristine-discard-proof-fixture'
import { createTestOwnerPristineDiscardProofTransport, testOwnerPristineDiscardRequestManifest as reviewedRequestManifest } from './contextual-test-pristine-discard-proof-transport'
export { createTestOwnerPristineDiscardProofTransport } from './contextual-test-pristine-discard-proof-transport'
import { testOwnerPristineDiscardConcurrencyManifest } from './check-contextual-test-discard-concurrency'
import { testOwnerPristineDiscardDbPlanObjectIds } from './contextual-test-pristine-discard-db-contracts'
import { buildTestOwnerPristineDiscardNativeContractsManifest, createTestOwnerPristineDiscardNativeContracts } from './contextual-test-draft-save-native-contracts'
import { generateTestDraftSaveTypes } from './generate-contextual-test-draft-save-types'

const paths = Object.freeze(['/rest/v1/rpc/discard_pristine_test_draft_for_owner_v1'])
const cleanupMarker = 'PASS isolated test-owner-pristine-discard exact teardown and unchanged canonical baseline.\n'
const APP_CAPS = Object.freeze({ controls: 4000, actions: 200, totalMs: 900000, controlMs: 45000, totalBytes: 64 * 1024 * 1024 })
type Rows = Record<string, Array<Record<string, unknown>>>
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }

export function testOwnerPristineDiscardRequestManifest(f: TestOwnerPristineDiscardFixture) {
  assert(Object.isFrozen(f))
  return freeze({ ...reviewedRequestManifest(f), fixture: f, paths,
    rollbackReservedIds: [...testOwnerPristineDiscardConcurrencyManifest(f).extraAllocatedIds, ...testOwnerPristineDiscardDbPlanObjectIds(f)],
    expected: { cases: 18, privilegeProbes: 2, rpcRequests: 20, discards: 6, storageRequests: 0 } })
}
export function testOwnerPristineDiscardUnionManifest(original: ReturnType<typeof newAssignmentListProofFixture>, f: TestOwnerPristineDiscardFixture,
  reviewedHead: string, repository: string) {
  const sql = buildTestOwnerPristineDiscardNativeContractsManifest(original, f, reviewedHead, repository)
  const project = `pika_assignment_list_${f.tag.slice(-12)}`
  return freeze({ version: 1, reviewedHead, originalSha256: testOwnerDigest(JSON.stringify(original.manifest)),
    application: testOwnerPristineDiscardRequestManifest(f), sql,
    applicationSetupSha256: testOwnerDigest(testOwnerPristineDiscardSetupSql(f, project)),
    applicationSnapshotSha256: testOwnerDigest(testOwnerPristineDiscardSnapshotSql(f)), applicationCapabilities: APP_CAPS,
    inventory: { ...f.inventory, sdkCases: 18, sdkDiscards: 6, privilegeDriftProbes: 2, rpcRequests: 20, storageRequests: 0, races: 14 } })
}

/** Only the real original canonical read-only receipt supplies this table set. */
export function testOwnerPristineDiscardCanonicalTableCatalog(input: { rowDigests: string }) {
  assert(typeof input.rowDigests === 'string' && Buffer.byteLength(input.rowDigests) <= TEST_OWNER_PRISTINE_DISCARD_CAPS.snapshotBytes)
  const rows: unknown = JSON.parse(input.rowDigests)
  assert(rows && typeof rows === 'object' && !Array.isArray(rows))
  const names = Object.keys(rows).sort()
  assert(names.length > 0 && names.length <= TEST_OWNER_PRISTINE_DISCARD_CAPS.fingerprintTables)
  assert(names.every(name => /^(public|private|storage)\.[a-z_0-9]+$/.test(name)))
  assert([...TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets'].every(name => names.includes(name)))
  return Object.freeze(names)
}
export function validateTestOwnerPristineDiscardSnapshotCatalog(input: unknown, expectedTables: readonly string[]): Rows {
  assert(boundedAssignmentListJson(input, TEST_OWNER_PRISTINE_DISCARD_CAPS.snapshotBytes))
  assert(input && typeof input === 'object' && !Array.isArray(input))
  const rows = input as Rows
  assert.deepEqual(Object.keys(rows).sort(), [...TEST_OWNER_PRISTINE_DISCARD_SNAPSHOT_TABLES, '__nontarget_fingerprints'].sort())
  assert(Object.values(rows).every(value => Array.isArray(value) && value.length <= TEST_OWNER_PRISTINE_DISCARD_CAPS.rowsPerTable))
  assert(Object.values(rows).reduce((count, value) => count + value.length, 0) <= TEST_OWNER_PRISTINE_DISCARD_CAPS.snapshotRows)
  assert(Array.isArray(expectedTables) && expectedTables.length > 0 && expectedTables.length <= TEST_OWNER_PRISTINE_DISCARD_CAPS.fingerprintTables)
  assert.equal(new Set(expectedTables).size, expectedTables.length)
  assert(expectedTables.every(name => /^(public|private|storage)\.[a-z_0-9]+$/.test(name)))
  const fingerprints = rows.__nontarget_fingerprints
  assert(fingerprints.length <= TEST_OWNER_PRISTINE_DISCARD_CAPS.fingerprintTables)
  for (const fingerprint of fingerprints) {
    assert.deepEqual(Object.keys(fingerprint).sort(), ['fingerprint', 'table'])
    assert(typeof fingerprint.table === 'string' && typeof fingerprint.fingerprint === 'string'
      && fingerprint.fingerprint.length > 0 && fingerprint.fingerprint.length <= 4096)
  }
  assert.deepEqual(fingerprints.map(row => row.table).sort(), [...expectedTables].sort(), 'Complete table catalog differs')
  return rows
}

export function testOwnerPristineDiscardMatrixCompletion(f: TestOwnerPristineDiscardFixture,
  transport: ReturnType<typeof createTestOwnerPristineDiscardProofTransport>, executed: readonly string[]) {
  assert.deepEqual(executed, [...f.privilegeProbes.map(c => c.label), ...f.cases.map(c => c.label)])
  const ledger = transport.getVerifiedLedger()
  assert(Object.isFrozen(ledger) && ledger.length === 12 && ledger.every(w => w.state === 'verified'))
  assert.deepEqual(ledger.map(w => w.caseLabel).sort(), f.cases.filter(c => c.expectedHTTP === 200).map(c => c.label).sort())
  assert.equal(ledger.filter(w => w.envelope.discarded).length, 6)
  assert.equal(transport.counts.rpc, 20); assert.equal(transport.counts.network, 20); assert.equal(transport.counts.storage, 0)
  assert.equal(transport.evidence.rawPrivilegeFailures, 2)
  assert.deepEqual(transport.evidence.rawPrivilegeContexts, ['inner-156-capability', 'outer-rpc-acl'])
  return freeze({ sdkCases: 18, sdkDiscards: 6, rpcRequests: 20, storageRequests: 0 })
}

export function parseTestOwnerPristineDiscardLifecycleArgs(args: string[]) {
  const generateTypes = args.length === 5 && args[4] === '--generate-types'
  const input = parseAssignmentListLifecycleArgs(generateTypes ? args.slice(0, 4) : args)
  assert(!generateTypes || input.mode === 'normal'); return { ...input, generateTypes }
}
export function testOwnerPristineDiscardForcedReceipt(mode: string, error: unknown, complete: boolean) {
  if (complete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError
    && error.primary?.stage === mode && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure'
    && error.cleanupFailures.length === 0) return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-owner-pristine-discard lifecycle: ${mode}.\n`, exitCode: 1 }
  return null
}
export function testOwnerPristineDiscardSetupDiagnostic(stage: unknown, error: unknown) {
  const stages = ['pending', 'app-guard', 'app-write', 'app-snapshot', 'app-verify', 'sql-prepare', 'sql-setup', 'complete']
  const phase = typeof stage === 'string' && stages.includes(stage) ? stage : 'unknown'
  const lifecycle = error instanceof AssignmentListLifecycleError ? error : undefined, cause = lifecycle ? lifecycle.primary?.error : error
  const inherited = ['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'after-fixture', 'before-capture'].includes(lifecycle?.primary?.stage ?? '') ? lifecycle!.primary!.stage : 'unknown'
  const locations = ['check-contextual-test-discard-concurrency.ts', 'contextual-test-pristine-discard-db-contracts.ts', 'contextual-test-draft-save-native-contracts.ts', 'check-contextual-test-owner-pristine-discard-lifecycle.ts']
  const stack = cause instanceof assert.AssertionError ? cause.stack ?? '' : ''
  const frame = stack.split('\n').find(line => /^\s+at /.test(line) && locations.some(file => line.includes(`/scripts/${file}:`)))
  const coordinate = frame?.match(/\/scripts\/([a-z-]+\.ts):([1-9]\d{0,4}):[1-9]\d{0,4}\)?$/)
  const location = coordinate && locations.includes(coordinate[1]) ? `${coordinate[1]}:${coordinate[2]}` : 'unknown'
  const failure = cause instanceof assert.AssertionError ? 'assertion' : cause instanceof Error && cause.message === 'Private platform command failed' ? 'platform-command' : 'unknown'
  return `DIAG test-owner-pristine-discard setup=${phase} lifecycle=${inherited} cleanup=${lifecycle ? lifecycle.cleanupFailures.length ? 'present' : 'none' : 'unknown'} failure=${failure} location=${location}.\n`
}
async function exactSnapshotFinally<T>(before: Rows, snapshot: () => Promise<Rows>, operation: () => Promise<T>) {
  let primary: unknown; let failed = false; let receipt: T | undefined
  try { receipt = await operation() }
  catch (error) { failed = true; primary = error }
  try { assert.deepEqual(await snapshot(), before, 'Application restoration rows changed') }
  catch (error) { if (failed) throw new AggregateError([primary, error], 'Private discard snapshot restoration failed'); throw error }
  if (failed) throw primary
  return receipt!
}
export async function verifyTestOwnerPristineDiscardPrivilegeRestoration(before: Rows, snapshot: () => Promise<Rows>,
  probe: () => Promise<{ privilegeRestored: boolean; fixtureUnchanged: boolean; discardAclSha256: string } |
    { privilegeRestored: boolean; fixtureUnchanged: boolean; legacyDiscardAclSha256: string }>) {
  return exactSnapshotFinally(before, snapshot, async () => {
    const receipt = await probe(); assert(receipt.privilegeRestored && receipt.fixtureUnchanged)
    assert.match('discardAclSha256' in receipt ? receipt.discardAclSha256 : receipt.legacyDiscardAclSha256, /^[a-f0-9]{64}$/)
    return receipt
  })
}

/** Validate the genuine CLI artifact, not a hand-authored contract overlay. */
export function validateTestOwnerPristineDiscardGeneratedTypes(source: string, expectedSha256: string) {
  assert(Buffer.byteLength(source) <= TEST_OWNER_PRISTINE_DISCARD_CAPS.snapshotBytes); assert.equal(testOwnerDigest(source), expectedSha256)
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true)
  const database = tree.statements.filter(ts.isTypeAliasDeclaration).filter(node => node.name.text === 'Database')
  assert.equal(database.length, 1); assert(database[0].modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
  function field(node: ts.TypeNode, name: string): ts.TypeNode {
    assert(ts.isTypeLiteralNode(node)); const found = node.members.filter(ts.isPropertySignature).filter(member => member.name.getText(tree) === name)
    assert.equal(found.length, 1); assert(!found[0].questionToken && found[0].type); return found[0].type
  }
  const declaration = field(field(field(database[0].type, 'public'), 'Functions'), 'discard_pristine_test_draft_for_owner_v1')
  assert(ts.isTypeLiteralNode(declaration)); assert.deepEqual(declaration.members.map(m => m.name?.getText(tree)).sort(), ['Args', 'Returns'])
  const args = field(declaration, 'Args'); assert(ts.isTypeLiteralNode(args))
  assert.deepEqual(args.members.map(m => m.name?.getText(tree)).sort(), ['p_actor_id', 'p_deadline', 'p_expected_draft_version', 'p_expected_test_updated_at', 'p_test_id'])
  for (const arg of args.members) assert(ts.isPropertySignature(arg) && !arg.questionToken
    && arg.type?.kind === (arg.name.getText(tree) === 'p_expected_draft_version' ? ts.SyntaxKind.NumberKeyword : ts.SyntaxKind.StringKeyword))
  const returns = field(declaration, 'Returns'); assert(ts.isTypeReferenceNode(returns) && returns.typeName.getText(tree) === 'Json')
  return true
}

export async function testOwnerPristineDiscardLifecycleMain(args = process.argv.slice(2)) {
  const input = parseTestOwnerPristineDiscardLifecycleArgs(args)
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), '')
  const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const migrations = loadAssignmentListReviewedMigrations(repository); assert(migrations.length >= 251)
  const original = newAssignmentListProofFixture(), f = newTestOwnerPristineDiscardFixture(original), projectId = `pika_assignment_list_${f.tag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(original), originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testOwnerPristineDiscardSetupSql(f, projectId), snapshotSql = testOwnerPristineDiscardSnapshotSql(f), union = testOwnerPristineDiscardUnionManifest(original, f, input.head, repository)
  const unionSha256 = testOwnerDigest(JSON.stringify(union)), started = Date.now()
  let target: ReturnType<typeof validateAssignmentListProofTarget> | undefined, session: Session | undefined
  let closure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined, expectedTables: readonly string[] | undefined, canonicalSha256: string | undefined
  let transport: ReturnType<typeof createTestOwnerPristineDiscardProofTransport> | undefined, client: ReturnType<typeof createClient<Database>> | undefined
  let sqlContracts: ReturnType<typeof createTestOwnerPristineDiscardNativeContracts> | undefined, nativeReceipt: Awaited<ReturnType<NonNullable<typeof sqlContracts>['run']>> | undefined
  let complete = false, matrixComplete = false, sqlComplete = false, setupStage = 'pending', controls = 0, actions = 0, appBytes = 0
  let typesReceipt: Awaited<ReturnType<typeof generateTestDraftSaveTypes>> | undefined
  let socket: { host: string; identity: Array<number | bigint> } | undefined
  const originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  function check() { assert(Date.now() - started < APP_CAPS.totalMs && controls <= APP_CAPS.controls && actions <= APP_CAPS.actions) }
  const bindSocket = ((path: Parameters<typeof statSync>[0]) => {
    assert(typeof path === 'string' && isAbsolute(path) && normalize(path) === path)
    const observed = statSync(path); assert(observed.isSocket())
    const bound = { host: `unix://${path}`, identity: [observed.dev, observed.ino, observed.mode, observed.rdev] }
    if (socket) assert.deepEqual(bound, socket); else socket = bound
    return observed
  }) as typeof statSync
  function privateSql(sql: string) {
    check(); assert(session && socket && [testOwnerGuardSql(projectId), snapshotSql].includes(sql)); assert(++actions <= APP_CAPS.actions)
    const output = execFileSync('docker', ['--host', socket.host, 'exec', '-i', '-e', `PGAPPNAME=${projectId}_fixture`, session.containerId,
      'psql', '-U', 'postgres', '-d', 'postgres', '-XqAt', '-v', 'ON_ERROR_STOP=1'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: Math.min(APP_CAPS.controlMs, APP_CAPS.totalMs - (Date.now() - started)), maxBuffer: TEST_OWNER_PRISTINE_DISCARD_CAPS.snapshotBytes }).trim()
    appBytes += Buffer.byteLength(output); assert(appBytes <= APP_CAPS.totalBytes); check(); return output
  }
  async function appGuard() {
    check(); assert(target && session); assert(++controls <= APP_CAPS.controls)
    assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['rev-parse', '--show-toplevel']), repository); assert.equal(git(['status', '--porcelain']), '')
    assert.equal(draftSaveMigrationManifestSha256(repository), union.sql.migrationManifestSha256)
    assert.equal(testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/251_contextual_test_pristine_owner_discard.sql'), 'utf8')), union.sql.sourceSha256)
    closure = validateIntegratedGuardResources(await draftSaveProofDockerInventory({ stat: bindSocket }), projectId, session.containerId, closure)
    assert.equal(privateSql(testOwnerGuardSql(projectId)), 'ok'); check()
  }
  async function sdkGuard() { await appGuard(); assert(sqlContracts); await sqlContracts.verifyTarget(); check() }
  async function snapshot(): Promise<Rows> {
    assert(expectedTables && testOwnerDigest(snapshotSql) === union.applicationSnapshotSha256)
    await appGuard(); return validateTestOwnerPristineDiscardSnapshotCatalog(JSON.parse(privateSql(snapshotSql)), expectedTables)
  }
  async function setup() {
    setupStage = 'app-guard'; assert.equal(testOwnerDigest(setupSql), union.applicationSetupSha256); await appGuard(); assert(session)
    setupStage = 'app-write'; assert(++actions <= APP_CAPS.actions); await native.executeSql({ ...session, sql: setupSql })
    setupStage = 'app-snapshot'; const rows = await snapshot()
    setupStage = 'app-verify'; assert(expectedTables); validateTestOwnerPristineDiscardSetupSnapshot(f, rows, expectedTables); assert(closure)
    assert.equal(testOwnerDigest(JSON.stringify(union)), unionSha256); setupStage = 'sql-prepare'
    sqlContracts = createTestOwnerPristineDiscardNativeContracts({ repository, reviewedHead: input.head, original, fixture: f, capturedResources: closure,
      containerId: session.containerId, acceptedManifestSha256: testOwnerDigest(JSON.stringify(union.sql)) })
    setupStage = 'sql-setup'; const receipt = await sqlContracts.setup()
    assert.equal(receipt.fixtureSha256, testOwnerDigest(JSON.stringify(f))); assert.equal(receipt.setupSha256, testOwnerDigest(union.sql.setup))
    complete = true; setupStage = 'complete'
  }
  async function matrix() {
    assert(complete && !matrixComplete && client && transport && sqlContracts)
    const { discardContextualPristineTestDraft } = await import('../src/lib/server/contextual-test-pristine-discard')
    const executed: string[] = []
    async function runCase(c: (typeof f.cases)[number] | (typeof f.privilegeProbes)[number]) {
      const before = await snapshot(), count = transport!.counts.rpc, startTime = Date.now()
      transport!.readContext(c.label, startTime)
      const discard = () => discardContextualPristineTestDraft({ supabase: client!, actorId: c.actorId, testId: c.testId, input: c.input, deadline: startTime + 20000 })
      let result: unknown
      if (c.expectedHTTP === 200) result = await discard()
      else await assert.rejects(discard, error => error instanceof ApiError && error.statusCode === c.expectedHTTP)
      assert.equal(transport!.counts.rpc - count, 1)
      transport!.verifyEffects(before, await snapshot(), result)
      executed.push(c.label)
    }
    // Probes and rollback contracts run before normal SDK removals so all their
    // fixed targets exist. The same transport retains whole-snapshot continuity.
    for (const c of f.privilegeProbes) {
      const beforePrivilege = await snapshot()
      const callback = async () => {
        const count = transport!.counts.rpc, raw = transport!.evidence.rawPrivilegeFailures
        await runCase(c)
        assert.equal(transport!.counts.rpc - count, 1); assert.equal(transport!.evidence.rawPrivilegeFailures - raw, 1)
        assert(transport!.evidence.rawPrivilegeContexts.includes(c.context))
        return { status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }
      }
      await verifyTestOwnerPristineDiscardPrivilegeRestoration(beforePrivilege, snapshot, () => c.context === 'outer-rpc-acl'
        ? sqlContracts!.probeDiscardPrivilegeDrift(callback) : sqlContracts!.probeLegacyDiscardPrivilegeDrift(callback))
    }
    const preSdkBaseline = freeze(structuredClone(await snapshot()))
    nativeReceipt = await exactSnapshotFinally(preSdkBaseline, snapshot, async () => {
      const receipt = await sqlContracts!.run(); assert(receipt.fixtureUnchanged)
      assert.equal(receipt.manifestSha256, testOwnerDigest(JSON.stringify(union.sql))); return receipt
    })
    sqlComplete = true
    for (const c of f.cases) await runCase(c)
    testOwnerPristineDiscardMatrixCompletion(f, transport, executed); matrixComplete = true
    if (input.generateTypes) {
      assert(input.mode === 'normal' && complete && matrixComplete && sqlComplete)
      typesReceipt = await generateTestDraftSaveTypes({ repository, reviewedHead: input.head, projectId, guard: sdkGuard })
      assert.equal(typesReceipt.migrationManifestSha256, union.sql.migrationManifestSha256)
      validateTestOwnerPristineDiscardGeneratedTypes(readFileSync(typesReceipt.path, 'utf8'), typesReceipt.sha256)
    }
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations, mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
      restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) }, {
      ...native,
      async canonicalSnapshot(request) {
        const captured = await native.canonicalSnapshot(request), catalog = testOwnerPristineDiscardCanonicalTableCatalog(captured)
        if (expectedTables) assert.deepEqual(catalog, expectedTables); else { expectedTables = catalog; canonicalSha256 = testOwnerDigest(JSON.stringify(captured)) }
        return captured
      },
      async command(request) { const result = await native.command(request); if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result },
      async executeSql(request) {
        await native.executeSql(request)
        if (request.sql === originalSetup) {
          assert(!session && target && expectedTables); session = { ...request }
          transport = createTestOwnerPristineDiscardProofTransport(f, target, projectId, fetch, sdkGuard)
          client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
          await setup()
        }
      },
      async runCase(request) { const result = await native.runCase(request); if (!matrixComplete) await matrix(); return result },
    })
    assert(complete && matrixComplete && sqlComplete)
    process.stdout.write(`PASS isolated test-owner-pristine-discard eighteen actual installed-SDK helper/RPC cases; six exact pair removals; two different restored raw42501 probes; rollback SQL contracts and fourteen two-session schedules.\n${cleanupMarker}`)
    return freeze({ types: typesReceipt ?? null, proof: { reviewedHead: input.head, manifestSha256: unionSha256, canonicalSha256,
      tableCatalogSha256: testOwnerDigest(JSON.stringify(expectedTables)), sdkCases: 18,
      sdkDiscards: transport!.getVerifiedLedger().filter(w => w.envelope.discarded).length,
      rpcRequests: transport!.counts.rpc, storageRequests: transport!.counts.storage, exchangeBytes: transport!.counts.exchangeBytes, native: nativeReceipt } })
  } catch (error) {
    const forced = testOwnerPristineDiscardForcedReceipt(input.mode, error, complete)
    if (forced) { process.stdout.write(forced.stdout); process.stderr.write(forced.stderr); process.exitCode = forced.exitCode; return }
    process.stderr.write(testOwnerPristineDiscardSetupDiagnostic(setupStage, error))
    if (sqlContracts) process.stderr.write(sqlContracts.diagnostic())
    if (transport) process.stderr.write(transport.diagnostic())
    throw Error('Test owner create lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerPristineDiscardLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-pristine-discard lifecycle; private details withheld.\n'); process.exitCode = 1
})
