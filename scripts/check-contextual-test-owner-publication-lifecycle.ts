/** Inert closed publication profile. Source/AST checks are not native acceptance.
 * Only the reviewed exact-project lifecycle may replay the full schema. */
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
import { TEST_OWNER_PUBLICATION_CAPS, TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES,
  newTestOwnerPublicationFixture, testOwnerPublicationSetupSql, testOwnerPublicationSnapshotSql,
  validateTestOwnerPublicationSetupSnapshot, type TestOwnerPublicationFixture } from './contextual-test-publication-proof-fixture'
import { createTestOwnerPublicationProofTransport, testOwnerPublicationRequestManifest as reviewedRequestManifest } from './contextual-test-publication-proof-transport'
export { createTestOwnerPublicationProofTransport } from './contextual-test-publication-proof-transport'
import { buildTestOwnerPublicationNativeContractsManifest, createTestOwnerPublicationNativeContracts } from './contextual-test-draft-save-native-contracts'
import { generateTestDraftSaveTypes } from './generate-contextual-test-draft-save-types'
import { classroomTestQuotaProofCatalog } from './classroom-test-quota-proof-catalog'

const cleanupMarker = 'PASS isolated test-owner-publication exact teardown and unchanged canonical baseline.\n'
const APP_CAPS = Object.freeze({ controls: 4000, actions: 200, totalMs: 900000, controlMs: 45000, totalBytes: 64 * 1024 * 1024 })
type Rows = Record<string, Array<Record<string, unknown>>>
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

export function testOwnerPublicationUnionManifest(original: ReturnType<typeof newAssignmentListProofFixture>, fixture: TestOwnerPublicationFixture,
  reviewedHead: string, repository: string) {
  const sql = buildTestOwnerPublicationNativeContractsManifest(original, fixture, reviewedHead, repository)
  const project = `pika_assignment_list_${fixture.tag.slice(-12)}`
  return freeze({ version: 1, reviewedHead, originalSha256: testOwnerDigest(JSON.stringify(original.manifest)),
    application: reviewedRequestManifest(fixture), sql,
    applicationSetupSha256: testOwnerDigest(testOwnerPublicationSetupSql(fixture, project)),
    applicationSnapshotSha256: testOwnerDigest(testOwnerPublicationSnapshotSql(fixture)), applicationCapabilities: APP_CAPS,
    inventory: { ...fixture.inventory, sdkCases: 10, sdkPublications: 3, privilegeDriftProbes: 4, rpcRequests: 20, storageRequests: 0,
      rollbackSchedules: 12, committedTransitions: 5 },
    reservations: { nativeActions: 149, nativeReserve: 51, applicationActions: 152, applicationReserve: 48, combinedReservedActions: 301,
      sdkGuardInvocations: 40, normalSDKGuards: 26, probeSDKGuards: 14 } })
}

/** Derive the complete table closure from the original canonical receipt only. */
export function testOwnerPublicationCanonicalTableCatalog(input: { rowDigests: string }) {
  assert(typeof input.rowDigests === 'string' && Buffer.byteLength(input.rowDigests) <= TEST_OWNER_PUBLICATION_CAPS.snapshotBytes)
  const value: unknown = JSON.parse(input.rowDigests)
  assert(value && typeof value === 'object' && !Array.isArray(value))
  const names = Object.keys(value).sort()
  assert(names.length > 0 && names.length <= TEST_OWNER_PUBLICATION_CAPS.fingerprintTables)
  assert(names.every(name => /^(public|private|storage)\.[a-z_0-9]+$/.test(name)))
  assert([...TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets'].every(name => names.includes(name)))
  return Object.freeze(names)
}

export function validateTestOwnerPublicationSnapshotCatalog(input: unknown, expectedTables: readonly string[]): Rows {
  assert(boundedAssignmentListJson(input, TEST_OWNER_PUBLICATION_CAPS.snapshotBytes))
  assert(input && typeof input === 'object' && !Array.isArray(input))
  const rows = input as Rows
  assert.deepEqual(Object.keys(rows).sort(), [...TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, '__nontarget_fingerprints'].sort())
  assert(Object.values(rows).every(value => Array.isArray(value) && value.length <= TEST_OWNER_PUBLICATION_CAPS.rowsPerTable))
  assert(Object.values(rows).reduce((count, value) => count + value.length, 0) <= TEST_OWNER_PUBLICATION_CAPS.snapshotRows)
  assert(expectedTables.length > 0 && expectedTables.length <= TEST_OWNER_PUBLICATION_CAPS.fingerprintTables)
  assert.equal(new Set(expectedTables).size, expectedTables.length)
  assert(expectedTables.every(name => /^(public|private|storage)\.[a-z_0-9]+$/.test(name)))
  for (const fingerprint of rows.__nontarget_fingerprints) {
    assert(fingerprint && typeof fingerprint === 'object' && !Array.isArray(fingerprint))
    assert.deepEqual(Object.keys(fingerprint).sort(), ['fingerprint', 'table'])
    assert(typeof fingerprint.table === 'string' && typeof fingerprint.fingerprint === 'string'
      && fingerprint.fingerprint.length > 0 && fingerprint.fingerprint.length <= 4096)
  }
  assert.deepEqual(rows.__nontarget_fingerprints.map(row => row.table).sort(), [...expectedTables].sort(), 'Complete table catalog differs')
  return rows
}

export async function verifyTestOwnerPublicationPrivilegeRestoration(before: Rows, snapshot: () => Promise<Rows>,
  probe: () => Promise<{ privilegeRestored: boolean; fixtureUnchanged: boolean; snapshotAclSha256: string }>) {
  let failed = false; let primary: unknown
  let receipt: Awaited<ReturnType<typeof probe>> | undefined
  try {
    receipt = await probe(); assert(receipt.privilegeRestored && receipt.fixtureUnchanged)
    assert.match(receipt.snapshotAclSha256, /^[a-f0-9]{64}$/)
  } catch (error) { failed = true; primary = error }
  try { assert.deepEqual(await snapshot(), before, 'Application restoration rows changed') }
  catch (error) {
    if (failed) throw new AggregateError([primary, error], 'Private publication restoration failed')
    throw error
  }
  if (failed) throw primary
  return receipt!
}

export function testOwnerPublicationMatrixCompletion(fixture: TestOwnerPublicationFixture,
  transport: ReturnType<typeof createTestOwnerPublicationProofTransport>, executed: readonly string[]) {
  assert.deepEqual(executed, [...fixture.privilegeProbes.map(c => c.label), ...fixture.cases.map(c => c.label)])
  const ledger = transport.getVerifiedLedger()
  assert(Object.isFrozen(ledger) && ledger.length === 8 && ledger.every(w => w.state === 'verified'))
  assert.deepEqual(ledger.filter(w => w.kind === 'publication').map(w => w.caseLabel).sort(), fixture.cases.filter(c => c.expectedHTTP === 200).map(c => c.label).sort())
  assert.deepEqual(ledger.filter(w => w.kind === 'transition').map(w => w.caseLabel), fixture.transitions.map(t => t.label))
  assert.equal(transport.counts.rpc, 20); assert.equal(transport.counts.network, 20); assert.equal(transport.counts.storage, 0)
  assert.equal(transport.evidence.rawPrivilegeFailures, 4)
  assert.deepEqual(transport.evidence.rawPrivilegeContexts, fixture.privilegeProbes.map(c => c.context).sort())
  const completion = transport.completion()
  assert(Object.isFrozen(completion) && completion.complete)
  assert.deepEqual(completion.verifiedContextLabels, executed)
  assert.deepEqual(completion.verifiedTransitionLabels, fixture.transitions.map(t => t.label))
  // Full source-sealed transition ledger completion is also checked by the
  // native runner. The adapter retains the SAME chain before SDK effects.
  return freeze({ sdkCases: 10, sdkPublications: 3, rpcRequests: 20, storageRequests: 0, verifiedEffects: ledger.length })
}

async function exactSnapshotFinally<T>(before: Rows, snapshot: () => Promise<Rows>, operation: () => Promise<T>) {
  let primary: unknown; let failed = false; let receipt: T | undefined
  try { receipt = await operation() } catch (error) { failed = true; primary = error }
  try { assert.deepEqual(await snapshot(), before, 'Application rollback rows changed') }
  catch (error) { if (failed) throw new AggregateError([primary, error], 'Private publication rollback failed'); throw error }
  if (failed) throw primary
  return receipt!
}

export function testOwnerPublicationSetupDiagnostic(stage: unknown, error: unknown) {
  const allowed = ['pending', 'app-guard', 'app-write', 'app-snapshot', 'app-verify', 'sql-prepare', 'sql-setup', 'complete']
  const setup = typeof stage === 'string' && allowed.includes(stage) ? stage : 'unknown'
  const lifecycle = error instanceof AssignmentListLifecycleError ? error : undefined
  const phases = ['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'after-fixture', 'before-capture']
  const phase = phases.includes(lifecycle?.primary?.stage ?? '') ? lifecycle!.primary!.stage : 'unknown'
  const cause = lifecycle ? lifecycle.primary?.error : error
  const failure = cause instanceof assert.AssertionError ? 'assertion' : 'unknown'
  // Only fixed filenames and bounded numeric coordinates leave the private proof.
  // Assertion values/messages and full stack/path text may contain source rows.
  const locations = ['check-contextual-test-publication-concurrency.ts', 'contextual-test-draft-save-native-contracts.ts',
    'contextual-test-publication-proof-fixture.ts', 'check-contextual-test-owner-publication-lifecycle.ts']
  const header = cause instanceof assert.AssertionError ? `AssertionError [ERR_ASSERTION]: ${cause.message}\n` : ''
  // Strip the entire assertion message before looking for frames, including any
  // row-shaped text that resembles a stack frame. Unknown stack formats stay closed.
  const stack = cause instanceof assert.AssertionError && cause.stack?.startsWith(header)
    ? cause.stack.slice(header.length).slice(-4096) : ''
  const frame = stack.split('\n').find(line => /^\s+at /.test(line) && locations.some(file => line.includes(`/scripts/${file}:`)))
  const coordinate = frame?.match(/\/scripts\/([a-z-]+\.ts):([1-9]\d{0,4}):([1-9]\d{0,4})\)?$/)
  const location = coordinate && locations.includes(coordinate[1]) ? `${coordinate[1]}:${coordinate[2]}:${coordinate[3]}` : 'unknown'
  const reasons = new Map([['Publication contention deadline exhausted', 'contention-deadline'],
    ['Publication race deadline exhausted', 'shared-race-deadline'], ['Committed publication deadline exhausted', 'committed-deadline']])
  const reason = cause instanceof assert.AssertionError ? reasons.get(cause.message) ?? 'unknown' : 'unknown'
  return `DIAG test-owner-publication setup=${setup} lifecycle=${phase} cleanup=${lifecycle ? lifecycle.cleanupFailures.length ? 'present' : 'none' : 'unknown'} failure=${failure} location=${location} reason=${reason}.\n`
}

export function parseTestOwnerPublicationLifecycleArgs(args: string[]) {
  const generateTypes = args.length === 5 && args[4] === '--generate-types'
  const input = parseAssignmentListLifecycleArgs(generateTypes ? args.slice(0, 4) : args)
  assert(!generateTypes || input.mode === 'normal')
  return { ...input, generateTypes }
}

export function testOwnerPublicationForcedReceipt(mode: string, error: unknown, complete: boolean) {
  if (complete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError
    && error.primary?.stage === mode && error.primary.error instanceof Error
    && error.primary.error.message === 'Forced isolated lifecycle failure' && error.cleanupFailures.length === 0) {
    return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-owner-publication lifecycle: ${mode}.\n`, exitCode: 1 }
  }
  return null
}

/** Shape verification supplements genuine CLI provenance, never substitutes it.
 * The generator remains the unchanged full-chain CLI producer; no overlay. */
export function validateTestOwnerPublicationGeneratedTypes(source: string, expectedSha256: string) {
  assert(Buffer.byteLength(source) <= TEST_OWNER_PUBLICATION_CAPS.snapshotBytes)
  assert.equal(testOwnerDigest(source), expectedSha256)
  const syntax = ts.transpileModule(source, { reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.Latest, module: ts.ModuleKind.ESNext } })
  assert(!syntax.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error))
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = tree.statements.filter(ts.isTypeAliasDeclaration).filter(n => n.name.text === 'Database')
  assert.equal(declarations.length, 1)
  assert(declarations[0].modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
  function field(node: ts.TypeNode, name: string): ts.TypeNode {
    assert(ts.isTypeLiteralNode(node))
    const found = node.members.filter(ts.isPropertySignature).filter(m => m.name.getText(tree) === name)
    assert.equal(found.length, 1); assert(!found[0].questionToken && found[0].type)
    return found[0].type
  }
  const declaration = field(field(field(declarations[0].type, 'public'), 'Functions'), 'publish_test_from_draft_for_owner_v1')
  assert(ts.isTypeLiteralNode(declaration))
  assert.deepEqual(declaration.members.map(m => m.name?.getText(tree)).sort(), ['Args', 'Returns'])
  const args = field(declaration, 'Args'); assert(ts.isTypeLiteralNode(args))
  assert.deepEqual(args.members.map(m => m.name?.getText(tree)).sort(),
    ['p_actor_id', 'p_classroom_id', 'p_deadline', 'p_expected_authoring_sha256', 'p_expected_draft_version', 'p_test_id', 'p_validated_content'])
  for (const arg of args.members) {
    assert(ts.isPropertySignature(arg) && !arg.questionToken && arg.type)
    const name = arg.name.getText(tree)
    if (name === 'p_validated_content') assert(ts.isTypeReferenceNode(arg.type) && arg.type.typeName.getText(tree) === 'Json' && !arg.type.typeArguments)
    else assert.equal(arg.type.kind, name === 'p_expected_draft_version' ? ts.SyntaxKind.NumberKeyword : ts.SyntaxKind.StringKeyword)
  }
  const returns = field(declaration, 'Returns')
  assert(ts.isTypeReferenceNode(returns) && returns.typeName.getText(tree) === 'Json' && !returns.typeArguments)
  return true
}

export async function testOwnerPublicationLifecycleMain(args = process.argv.slice(2)) {
  const input = parseTestOwnerPublicationLifecycleArgs(args)
  const started = Date.now(), absoluteDeadline = started + APP_CAPS.totalMs
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), '')
  const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const migrations = loadAssignmentListReviewedMigrations(repository); assert(migrations.length >= 252)
  const original = newAssignmentListProofFixture(), f = newTestOwnerPublicationFixture(original), projectId = `pika_assignment_list_${f.tag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(original), originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testOwnerPublicationSetupSql(f, projectId), snapshotSql = testOwnerPublicationSnapshotSql(f), union = testOwnerPublicationUnionManifest(original, f, input.head, repository)
  const unionSha256 = testOwnerDigest(JSON.stringify(union))
  let target: ReturnType<typeof validateAssignmentListProofTarget> | undefined, session: Session | undefined
  let closure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined, expectedTables: readonly string[] | undefined, canonicalTables: readonly string[] | undefined, canonicalSha256: string | undefined
  let transport: ReturnType<typeof createTestOwnerPublicationProofTransport> | undefined, client: ReturnType<typeof createClient<Database>> | undefined
  let sqlContracts: ReturnType<typeof createTestOwnerPublicationNativeContracts> | undefined, nativeReceipt: Awaited<ReturnType<NonNullable<typeof sqlContracts>['run']>> | undefined
  let committedReceipt: Awaited<ReturnType<NonNullable<typeof sqlContracts>['runCommittedTransitions']>> | undefined
  let complete = false, matrixComplete = false, sqlComplete = false, setupStage = 'pending', controls = 0, actions = 0, appBytes = 0
  let typesReceipt: Awaited<ReturnType<typeof generateTestDraftSaveTypes>> | undefined
  let socket: { host: string; identity: Array<number | bigint> } | undefined
  const originalPal = process.env.PAL_ENABLED; process.env.PAL_ENABLED = 'false'
  function check() { assert(Date.now() < absoluteDeadline && controls <= APP_CAPS.controls && actions <= APP_CAPS.actions) }
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
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: Math.min(APP_CAPS.controlMs, APP_CAPS.totalMs - (Date.now() - started)), maxBuffer: TEST_OWNER_PUBLICATION_CAPS.snapshotBytes }).trim()
    appBytes += Buffer.byteLength(output); assert(appBytes <= APP_CAPS.totalBytes); check(); return output
  }
  async function appGuard() {
    check(); assert(target && session); assert(++controls <= APP_CAPS.controls)
    assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['rev-parse', '--show-toplevel']), repository); assert.equal(git(['status', '--porcelain']), '')
    assert.equal(draftSaveMigrationManifestSha256(repository), union.sql.migrationManifestSha256)
    assert.equal(testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/252_contextual_test_owner_publication.sql'), 'utf8')), union.sql.sourceSha256)
    closure = validateIntegratedGuardResources(await draftSaveProofDockerInventory({ stat: bindSocket }), projectId, session.containerId, closure)
    assert.equal(privateSql(testOwnerGuardSql(projectId)), 'ok'); check()
  }
  async function sdkGuard() { await appGuard(); assert(sqlContracts); await sqlContracts.verifyTarget(); check() }
  async function snapshot(): Promise<Rows> {
    assert(expectedTables && testOwnerDigest(snapshotSql) === union.applicationSnapshotSha256)
    await appGuard(); return validateTestOwnerPublicationSnapshotCatalog(JSON.parse(privateSql(snapshotSql)), expectedTables)
  }
  async function setup() {
    setupStage = 'app-guard'; assert.equal(testOwnerDigest(setupSql), union.applicationSetupSha256); await appGuard(); assert(session)
    setupStage = 'app-write'; assert(++actions <= APP_CAPS.actions); await native.executeSql({ ...session, sql: setupSql })
    setupStage = 'app-snapshot'; const rows = await snapshot()
    setupStage = 'app-verify'; assert(expectedTables); validateTestOwnerPublicationSetupSnapshot(f, rows, expectedTables); assert(closure)
    assert.equal(testOwnerDigest(JSON.stringify(union)), unionSha256); setupStage = 'sql-prepare'
    sqlContracts = createTestOwnerPublicationNativeContracts({ repository, reviewedHead: input.head, original, fixture: f, capturedResources: closure,
      containerId: session.containerId, acceptedManifestSha256: testOwnerDigest(JSON.stringify(union.sql)), absoluteDeadline })
    setupStage = 'sql-setup'; const receipt = await sqlContracts.setup()
    assert.equal(receipt.fixtureSha256, testOwnerDigest(JSON.stringify(f))); assert.equal(receipt.setupSha256, testOwnerDigest(union.sql.setup))
    complete = true; setupStage = 'complete'
  }
  async function matrix() {
    assert(complete && !matrixComplete && client && transport && sqlContracts)
    const { publishContextualTest } = await import('../src/lib/server/contextual-test-publication')
    const executed: string[] = []
    async function runCase(c: (typeof f.cases)[number] | (typeof f.privilegeProbes)[number]) {
      const before = await snapshot(), count = transport!.counts.rpc, startTime = Date.now()
      transport!.readContext(c.label, startTime)
      const publish = () => publishContextualTest({ supabase: client!, actorId: c.actorId, testId: c.testId, input: c.input, deadline: startTime + 20000 })
      let result: unknown
      if (c.expectedHTTP === 200) result = await publish()
      else await assert.rejects(publish, error => error instanceof ApiError && error.statusCode === c.expectedHTTP)
      assert.equal(transport!.counts.rpc - count, c.expectedRPCs)
      transport!.verifyEffects(before, await snapshot(), result)
      executed.push(c.label)
    }
    // Restore four different capabilities before rollback/committed schedules
    // and SDK publications. Never instantiate a second engine/transport ledger.
    for (const c of f.privilegeProbes) {
      const beforePrivilege = await snapshot()
      const callback = async () => {
        const count = transport!.counts.rpc, raw = transport!.evidence.rawPrivilegeFailures
        await runCase(c)
        assert.equal(transport!.counts.rpc - count, c.expectedRPCs); assert.equal(transport!.evidence.rawPrivilegeFailures - raw, 1)
        assert(transport!.evidence.rawPrivilegeContexts.includes(c.context))
      }
      const one = async () => { await callback(); return { status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const } }
      const two = async () => { await callback(); return { status: 503 as const, rpcCalls: 2 as const, rawCode: '42501' as const } }
      await verifyTestOwnerPublicationPrivilegeRestoration(beforePrivilege, snapshot, () => {
        if (c.context === 'snapshot247') return sqlContracts!.probePublicationSnapshotPrivilegeDrift(one)
        if (c.context === 'publication252') return sqlContracts!.probePublicationPrivilegeDrift(two)
        if (c.context === 'legacy139') return sqlContracts!.probeLegacyPublicationPrivilegeDrift(two)
        assert.equal(c.context, 'activation134'); return sqlContracts!.probeActivationPrivilegeDrift(two)
      })
    }
    const preSdkBaseline = freeze(structuredClone(await snapshot()))
    nativeReceipt = await exactSnapshotFinally(preSdkBaseline, snapshot, async () => {
      const receipt = await sqlContracts!.run(); assert(receipt.fixtureUnchanged)
      assert.equal(receipt.manifestSha256, testOwnerDigest(JSON.stringify(union.sql))); return receipt
    })
    committedReceipt = await sqlContracts.runCommittedTransitions()
    assert.equal(committedReceipt.manifestSha256, testOwnerDigest(JSON.stringify(union.sql)))
    assert.equal(committedReceipt.remainingSessions, 0)
    for (const r of committedReceipt.transitions.receipts) transport.verifyTransitionEffects(r.before, r.writerCommit, r.after, r.label, r.evidence)
    sqlComplete = true
    for (const c of f.cases) await runCase(c)
    testOwnerPublicationMatrixCompletion(f, transport, executed); matrixComplete = true
    if (input.generateTypes) {
      assert(input.mode === 'normal' && complete && matrixComplete && sqlComplete)
      typesReceipt = await generateTestDraftSaveTypes({ repository, reviewedHead: input.head, projectId, guard: sdkGuard })
      assert.equal(typesReceipt.migrationManifestSha256, union.sql.migrationManifestSha256)
      validateTestOwnerPublicationGeneratedTypes(readFileSync(typesReceipt.path, 'utf8'), typesReceipt.sha256)
    }
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations, mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
      restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) }, {
      ...native,
      async canonicalSnapshot(request) {
        const captured = await native.canonicalSnapshot(request), catalog = testOwnerPublicationCanonicalTableCatalog(captured)
        if (canonicalTables) assert.deepEqual(catalog, canonicalTables)
        else { canonicalTables = catalog; expectedTables = classroomTestQuotaProofCatalog(catalog, migrations); canonicalSha256 = testOwnerDigest(JSON.stringify(captured)) }
        return captured
      },
      async command(request) { const result = await native.command(request); if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result },
      async executeSql(request) {
        await native.executeSql(request)
        if (request.sql === originalSetup) {
          assert(!session && target && expectedTables); session = { ...request }
          transport = createTestOwnerPublicationProofTransport(f, target, projectId, fetch, sdkGuard)
          client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
          await setup()
        }
      },
      async runCase(request) { const result = await native.runCase(request); if (!matrixComplete) await matrix(); return result },
    })
    assert(complete && matrixComplete && sqlComplete)
    assert(nativeReceipt && committedReceipt)
    process.stdout.write(`PASS isolated test-owner-publication ten actual installed-SDK helper cases; three exact closed publications; four restored raw42501 probes; rollback SQL contracts, twelve held-lock schedules and five committed transitions.\n${cleanupMarker}`)
    return freeze({ types: typesReceipt ?? null, proof: { reviewedHead: input.head, manifestSha256: unionSha256, canonicalSha256,
      tableCatalogSha256: testOwnerDigest(JSON.stringify(expectedTables)), sdkCases: 10, sdkPublications: 3, committedTransitions: 5,
      rpcRequests: transport!.counts.rpc, storageRequests: transport!.counts.storage, exchangeBytes: transport!.counts.exchangeBytes,
      native: nativeReceipt, committed: committedReceipt, application: { controls, actions, exchangeBytes: appBytes },
      combinedActions: actions + committedReceipt.actions } })
  } catch (error) {
    const forced = testOwnerPublicationForcedReceipt(input.mode, error, complete)
    if (forced) { process.stdout.write(forced.stdout); process.stderr.write(forced.stderr); process.exitCode = forced.exitCode; return }
    process.stderr.write(testOwnerPublicationSetupDiagnostic(setupStage, error))
    if (sqlContracts) process.stderr.write(sqlContracts.diagnostic())
    if (transport) process.stderr.write(transport.diagnostic())
    throw Error('Test owner publication lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerPublicationLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-publication lifecycle; private details withheld.\n'); process.exitCode = 1
})
