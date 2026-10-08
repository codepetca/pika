/** Inert finite CREATE SDK/lifecycle source. Only root-reviewed invocation may
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
import { newTestOwnerCreateFixture, testOwnerCreateSetupSql, testOwnerCreateSnapshotSql,
  validateTestOwnerCreateSetupSnapshot, TEST_OWNER_CREATE_CAPS, TEST_OWNER_CREATE_SNAPSHOT_TABLES,
  type TestOwnerCreateFixture } from './contextual-test-owner-create-proof-fixture'
import { createTestOwnerCreateProofTransport, testOwnerCreateRequestManifest as reviewedRequestManifest } from './contextual-test-owner-create-proof-transport'
export { createTestOwnerCreateProofTransport } from './contextual-test-owner-create-proof-transport'
import { testOwnerCreateConcurrencyManifest } from './check-contextual-test-create-concurrency'
import { buildTestOwnerCreateNativeContractsManifest, createTestOwnerCreateNativeContracts } from './contextual-test-draft-save-native-contracts'
import { generateTestDraftSaveTypes } from './generate-contextual-test-draft-save-types'
import { classroomTestQuotaProofCatalog } from './classroom-test-quota-proof-catalog'

const paths = Object.freeze(['/rest/v1/rpc/create_test_for_owner_v1'])
const cleanupMarker = 'PASS isolated test-owner-create exact teardown and unchanged canonical baseline.\n'
const APP_CAPS = Object.freeze({ controls: 4000, actions: 200, totalMs: 900000, controlMs: 45000, totalBytes: 64 * 1024 * 1024 })
type Rows = Record<string, Array<Record<string, unknown>>>
type Session = Parameters<AssignmentListLifecycleAdapters['executeSql']>[0]
function freeze<T>(value: T): T { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }

export function testOwnerCreateRequestManifest(f: TestOwnerCreateFixture) {
  assert(Object.isFrozen(f))
  return freeze({ ...reviewedRequestManifest(f), fixture: f, paths,
    rollbackReservedIds: testOwnerCreateConcurrencyManifest(f).extraAllocatedIds,
    expected: { cases: 14, privilegeProbes: 1, rpcRequests: 15, creates: 8, storageRequests: 0 } })
}
export function testOwnerCreateUnionManifest(original: ReturnType<typeof newAssignmentListProofFixture>, f: TestOwnerCreateFixture,
  reviewedHead: string, repository: string) {
  const sql = buildTestOwnerCreateNativeContractsManifest(original, f, reviewedHead, repository)
  const project = `pika_assignment_list_${f.tag.slice(-12)}`
  return freeze({ version: 1, reviewedHead, originalSha256: testOwnerDigest(JSON.stringify(original.manifest)),
    application: testOwnerCreateRequestManifest(f), sql,
    applicationSetupSha256: testOwnerDigest(testOwnerCreateSetupSql(f, project)),
    applicationSnapshotSha256: testOwnerDigest(testOwnerCreateSnapshotSql(f)), applicationCapabilities: APP_CAPS,
    inventory: { ...f.inventory, sdkCases: 14, sdkCreates: 8, privilegeDriftProbes: 1, rpcRequests: 15, storageRequests: 0, races: 9 } })
}

/** Only the real original canonical read-only receipt supplies this table set. */
export function testOwnerCreateCanonicalTableCatalog(input: { rowDigests: string }) {
  assert(typeof input.rowDigests === 'string' && Buffer.byteLength(input.rowDigests) <= TEST_OWNER_CREATE_CAPS.snapshotBytes)
  const rows: unknown = JSON.parse(input.rowDigests)
  assert(rows && typeof rows === 'object' && !Array.isArray(rows))
  const names = Object.keys(rows).sort()
  assert(names.length > 0 && names.length <= TEST_OWNER_CREATE_CAPS.fingerprintTables)
  assert(names.every(name => /^(public|private|storage)\.[a-z_0-9]+$/.test(name)))
  assert([...TEST_OWNER_CREATE_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets'].every(name => names.includes(name)))
  return Object.freeze(names)
}
export function validateTestOwnerCreateSnapshotCatalog(input: unknown, expectedTables: readonly string[]): Rows {
  assert(boundedAssignmentListJson(input, TEST_OWNER_CREATE_CAPS.snapshotBytes))
  assert(input && typeof input === 'object' && !Array.isArray(input))
  const rows = input as Rows
  assert.deepEqual(Object.keys(rows).sort(), [...TEST_OWNER_CREATE_SNAPSHOT_TABLES, '__nontarget_fingerprints'].sort())
  assert(Object.values(rows).every(value => Array.isArray(value) && value.length <= TEST_OWNER_CREATE_CAPS.rowsPerTable))
  assert(Object.values(rows).reduce((count, value) => count + value.length, 0) <= TEST_OWNER_CREATE_CAPS.snapshotRows)
  assert(Array.isArray(expectedTables) && expectedTables.length > 0 && expectedTables.length <= TEST_OWNER_CREATE_CAPS.fingerprintTables)
  assert.equal(new Set(expectedTables).size, expectedTables.length)
  assert(expectedTables.every(name => /^(public|private|storage)\.[a-z_0-9]+$/.test(name)))
  const fingerprints = rows.__nontarget_fingerprints
  assert(fingerprints.length <= TEST_OWNER_CREATE_CAPS.fingerprintTables)
  for (const fingerprint of fingerprints) {
    assert.deepEqual(Object.keys(fingerprint).sort(), ['fingerprint', 'table'])
    assert(typeof fingerprint.table === 'string' && typeof fingerprint.fingerprint === 'string'
      && fingerprint.fingerprint.length > 0 && fingerprint.fingerprint.length <= 4096)
  }
  assert.deepEqual(fingerprints.map(row => row.table).sort(), [...expectedTables].sort(), 'Complete table catalog differs')
  return rows
}

/** A one-shot supplemental collision check, never a ledger setter or promotion.
 * Only the reviewed transport's verifyEffects sink accepts the raw witness. */
export function validateTestOwnerCreatePendingWitness(transport: ReturnType<typeof createTestOwnerCreateProofTransport>,
  caseLabel: string, reservedIds: readonly string[]) {
  const pending = transport.getPendingWitness()
  assert(pending && pending.caseLabel === caseLabel)
  const witness = pending.ledger.at(-1)
  assert(witness && witness.caseLabel === caseLabel && witness.state === 'provisional')
  assert(witness.ids.every(id => !reservedIds.includes(id)))
}
export function testOwnerCreateMatrixCompletion(f: TestOwnerCreateFixture,
  transport: ReturnType<typeof createTestOwnerCreateProofTransport>, executed: readonly string[]) {
  assert.deepEqual(executed, [...f.cases.slice(0, 13).map(c => c.label), f.privilegeProbe.label, f.cases[13].label])
  const ledger = transport.getVerifiedLedger()
  assert(Object.isFrozen(ledger) && ledger.length === 8 && ledger.every(w => w.state === 'verified'))
  assert.deepEqual(ledger.map(w => w.caseLabel).sort(), f.cases.filter(c => c.expectedHTTP === 201).map(c => c.label).sort())
  assert.equal(transport.counts.rpc, 15); assert.equal(transport.counts.network, 15); assert.equal(transport.counts.storage, 0)
  assert.equal(transport.evidence.rawPrivilegeFailures, 1)
  assert.equal(ledger.filter(w => w.caseLabel === 'bulk-1001-source' && w.envelope.test.position === 1001).length, 1)
  return freeze({ sdkCases: 14, sdkCreates: 8, rpcRequests: 15, storageRequests: 0 })
}

export function parseTestOwnerCreateLifecycleArgs(args: string[]) {
  const generateTypes = args.length === 5 && args[4] === '--generate-types'
  const input = parseAssignmentListLifecycleArgs(generateTypes ? args.slice(0, 4) : args)
  assert(!generateTypes || input.mode === 'normal'); return { ...input, generateTypes }
}
export function testOwnerCreateForcedReceipt(mode: string, error: unknown, complete: boolean) {
  if (complete && ['after-fixture', 'before-capture'].includes(mode) && error instanceof AssignmentListLifecycleError
    && error.primary?.stage === mode && error.primary.error instanceof Error && error.primary.error.message === 'Forced isolated lifecycle failure'
    && error.cleanupFailures.length === 0) return { stdout: cleanupMarker, stderr: `FAIL forced isolated test-owner-create lifecycle: ${mode}.\n`, exitCode: 1 }
  return null
}
export function testOwnerCreateSetupDiagnostic(stage: unknown, error: unknown) {
  const stages = ['pending', 'app-guard', 'app-write', 'app-snapshot', 'app-verify', 'sql-prepare', 'sql-setup', 'complete']
  const phase = typeof stage === 'string' && stages.includes(stage) ? stage : 'unknown'
  const lifecycle = error instanceof AssignmentListLifecycleError ? error : undefined, cause = lifecycle ? lifecycle.primary?.error : error
  const inherited = ['canonical-before', 'preflight', 'prepare', 'pre-start', 'start', 'capture', 'status', 'fixture', 'cases', 'revocations', 'after-fixture', 'before-capture'].includes(lifecycle?.primary?.stage ?? '') ? lifecycle!.primary!.stage : 'unknown'
  const locations = ['check-contextual-test-create-concurrency.ts', 'contextual-test-owner-create-db-contracts.ts', 'contextual-test-draft-save-native-contracts.ts', 'check-contextual-test-owner-create-lifecycle.ts']
  const stack = cause instanceof assert.AssertionError ? cause.stack ?? '' : ''
  const frame = stack.split('\n').find(line => /^\s+at /.test(line) && locations.some(file => line.includes(`/scripts/${file}:`)))
  const coordinate = frame?.match(/\/scripts\/([a-z-]+\.ts):([1-9]\d{0,4}):[1-9]\d{0,4}\)?$/)
  const location = coordinate && locations.includes(coordinate[1]) ? `${coordinate[1]}:${coordinate[2]}` : 'unknown'
  const failure = cause instanceof assert.AssertionError ? 'assertion' : cause instanceof Error && cause.message === 'Private platform command failed' ? 'platform-command' : 'unknown'
  return `DIAG test-owner-create setup=${phase} lifecycle=${inherited} cleanup=${lifecycle ? lifecycle.cleanupFailures.length ? 'present' : 'none' : 'unknown'} failure=${failure} location=${location}.\n`
}
async function exactSnapshotFinally<T>(before: Rows, snapshot: () => Promise<Rows>, operation: () => Promise<T>) {
  let primary: unknown; let failed = false; let receipt: T | undefined
  try { receipt = await operation() }
  catch (error) { failed = true; primary = error }
  try { assert.deepEqual(await snapshot(), before, 'Application restoration rows changed') }
  catch (error) { if (failed) throw new AggregateError([primary, error], 'Private CREATE snapshot restoration failed'); throw error }
  if (failed) throw primary
  return receipt!
}
export async function verifyTestOwnerCreatePrivilegeRestoration(before: Rows, snapshot: () => Promise<Rows>,
  probe: () => Promise<{ privilegeRestored: boolean; fixtureUnchanged: boolean; createAclSha256: string }>) {
  return exactSnapshotFinally(before, snapshot, async () => {
    const receipt = await probe(); assert(receipt.privilegeRestored && receipt.fixtureUnchanged); assert.match(receipt.createAclSha256, /^[a-f0-9]{64}$/)
    return receipt
  })
}

/** Validate the genuine CLI artifact, not a hand-authored contract overlay. */
export function validateTestOwnerCreateGeneratedTypes(source: string, expectedSha256: string) {
  assert(Buffer.byteLength(source) <= TEST_OWNER_CREATE_CAPS.snapshotBytes); assert.equal(testOwnerDigest(source), expectedSha256)
  const tree = ts.createSourceFile('generated.ts', source, ts.ScriptTarget.Latest, true)
  const database = tree.statements.filter(ts.isTypeAliasDeclaration).filter(node => node.name.text === 'Database')
  assert.equal(database.length, 1); assert(database[0].modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword))
  function field(node: ts.TypeNode, name: string): ts.TypeNode {
    assert(ts.isTypeLiteralNode(node)); const found = node.members.filter(ts.isPropertySignature).filter(member => member.name.getText(tree) === name)
    assert.equal(found.length, 1); assert(!found[0].questionToken && found[0].type); return found[0].type
  }
  const declaration = field(field(field(database[0].type, 'public'), 'Functions'), 'create_test_for_owner_v1')
  assert(ts.isTypeLiteralNode(declaration)); assert.deepEqual(declaration.members.map(m => m.name?.getText(tree)).sort(), ['Args', 'Returns'])
  const args = field(declaration, 'Args'); assert(ts.isTypeLiteralNode(args))
  assert.deepEqual(args.members.map(m => m.name?.getText(tree)).sort(), ['p_actor_id', 'p_classroom_id', 'p_deadline', 'p_title'])
  for (const arg of args.members) assert(ts.isPropertySignature(arg) && !arg.questionToken && arg.type?.kind === ts.SyntaxKind.StringKeyword)
  const returns = field(declaration, 'Returns'); assert(ts.isTypeReferenceNode(returns) && returns.typeName.getText(tree) === 'Json')
  return true
}

export async function testOwnerCreateLifecycleMain(args = process.argv.slice(2)) {
  const input = parseTestOwnerCreateLifecycleArgs(args)
  const git = (args: string[]) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 }).trim()
  assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['status', '--porcelain']), '')
  const repository = git(['rev-parse', '--show-toplevel']); assert.equal(repository, process.cwd())
  const migrations = loadAssignmentListReviewedMigrations(repository); assert(migrations.length >= 250)
  const original = newAssignmentListProofFixture(), f = newTestOwnerCreateFixture(original), projectId = `pika_assignment_list_${f.tag.slice(-12)}`
  const native = createAssignmentListNativeAdapters(original), originalSetup = assignmentListFixtureSetupSql(original, projectId)
  const setupSql = testOwnerCreateSetupSql(f, projectId), snapshotSql = testOwnerCreateSnapshotSql(f), union = testOwnerCreateUnionManifest(original, f, input.head, repository)
  const unionSha256 = testOwnerDigest(JSON.stringify(union)), started = Date.now()
  let target: ReturnType<typeof validateAssignmentListProofTarget> | undefined, session: Session | undefined
  let closure: Awaited<ReturnType<typeof assignmentListDockerInventory>> | undefined, expectedTables: readonly string[] | undefined, canonicalTables: readonly string[] | undefined, canonicalSha256: string | undefined
  let transport: ReturnType<typeof createTestOwnerCreateProofTransport> | undefined, client: ReturnType<typeof createClient<Database>> | undefined
  let sqlContracts: ReturnType<typeof createTestOwnerCreateNativeContracts> | undefined, nativeReceipt: Awaited<ReturnType<NonNullable<typeof sqlContracts>['run']>> | undefined
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
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: Math.min(APP_CAPS.controlMs, APP_CAPS.totalMs - (Date.now() - started)), maxBuffer: TEST_OWNER_CREATE_CAPS.snapshotBytes }).trim()
    appBytes += Buffer.byteLength(output); assert(appBytes <= APP_CAPS.totalBytes); check(); return output
  }
  async function appGuard() {
    check(); assert(target && session); assert(++controls <= APP_CAPS.controls)
    assert.equal(git(['rev-parse', 'HEAD']), input.head); assert.equal(git(['rev-parse', '--show-toplevel']), repository); assert.equal(git(['status', '--porcelain']), '')
    assert.equal(draftSaveMigrationManifestSha256(repository), union.sql.migrationManifestSha256)
    assert.equal(testOwnerDigest(readFileSync(resolve(repository, 'supabase/migrations/250_contextual_test_owner_create.sql'), 'utf8')), union.sql.sourceSha256)
    closure = validateIntegratedGuardResources(await draftSaveProofDockerInventory({ stat: bindSocket }), projectId, session.containerId, closure)
    assert.equal(privateSql(testOwnerGuardSql(projectId)), 'ok'); check()
  }
  async function sdkGuard() { await appGuard(); assert(sqlContracts); await sqlContracts.verifyTarget(); check() }
  async function snapshot(): Promise<Rows> {
    assert(expectedTables && testOwnerDigest(snapshotSql) === union.applicationSnapshotSha256)
    await appGuard(); return validateTestOwnerCreateSnapshotCatalog(JSON.parse(privateSql(snapshotSql)), expectedTables)
  }
  async function setup() {
    setupStage = 'app-guard'; assert.equal(testOwnerDigest(setupSql), union.applicationSetupSha256); await appGuard(); assert(session)
    setupStage = 'app-write'; assert(++actions <= APP_CAPS.actions); await native.executeSql({ ...session, sql: setupSql })
    setupStage = 'app-snapshot'; const rows = await snapshot()
    setupStage = 'app-verify'; assert(expectedTables); validateTestOwnerCreateSetupSnapshot(f, rows, expectedTables); assert(closure)
    assert.equal(testOwnerDigest(JSON.stringify(union)), unionSha256); setupStage = 'sql-prepare'
    sqlContracts = createTestOwnerCreateNativeContracts({ repository, reviewedHead: input.head, original, fixture: f, capturedResources: closure,
      containerId: session.containerId, acceptedManifestSha256: testOwnerDigest(JSON.stringify(union.sql)) })
    setupStage = 'sql-setup'; const receipt = await sqlContracts.setup()
    assert.equal(receipt.fixtureSha256, testOwnerDigest(JSON.stringify(f))); assert.equal(receipt.setupSha256, testOwnerDigest(union.sql.setup))
    complete = true; setupStage = 'complete'
  }
  async function matrix() {
    assert(complete && !matrixComplete && client && transport && sqlContracts)
    const { createContextualTest } = await import('../src/lib/server/contextual-test-create')
    const executed: string[] = []
    async function runCase(c: (typeof f.cases)[number] | typeof f.privilegeProbe) {
      const before = await snapshot(), count = transport!.counts.rpc, startTime = Date.now()
      transport!.readContext(c.label, startTime)
      const create = () => createContextualTest({ supabase: client!, actorId: c.actorId, input: c.input, deadline: startTime + 20000 })
      let result: unknown
      if (c.expectedHTTP === 201) {
        result = await create()
        validateTestOwnerCreatePendingWitness(transport!, c.label, union.sql.concurrency.extraAllocatedIds)
      }
      else await assert.rejects(create, error => error instanceof ApiError && error.statusCode === c.expectedHTTP)
      assert.equal(transport!.counts.rpc - count, 1)
      transport!.verifyEffects(before, await snapshot(), result)
      executed.push(c.label)
    }
    for (const c of f.cases.slice(0, 13)) await runCase(c)
    const beforePrivilege = await snapshot()
    await verifyTestOwnerCreatePrivilegeRestoration(beforePrivilege, snapshot, () => sqlContracts!.probeCreatePrivilegeDrift(async () => {
      const count = transport!.counts.rpc, raw = transport!.evidence.rawPrivilegeFailures
      await runCase(f.privilegeProbe)
      assert.equal(transport!.counts.rpc - count, 1); assert.equal(transport!.evidence.rawPrivilegeFailures - raw, 1)
      return { status: 503 as const, rpcCalls: 1 as const, rawCode: '42501' as const }
    }))
    await runCase(f.cases[13]); testOwnerCreateMatrixCompletion(f, transport, executed)
    const postSdkBaseline = freeze(structuredClone(await snapshot()))
    nativeReceipt = await exactSnapshotFinally(postSdkBaseline, snapshot, async () => {
      const receipt = await sqlContracts!.run(); assert(receipt.fixtureUnchanged)
      assert.equal(receipt.manifestSha256, testOwnerDigest(JSON.stringify(union.sql))); return receipt
    })
    sqlComplete = true; matrixComplete = true
    if (input.generateTypes) {
      assert(input.mode === 'normal' && complete && matrixComplete && sqlComplete)
      typesReceipt = await generateTestDraftSaveTypes({ repository, reviewedHead: input.head, projectId, guard: sdkGuard })
      assert.equal(typesReceipt.migrationManifestSha256, union.sql.migrationManifestSha256)
      validateTestOwnerCreateGeneratedTypes(readFileSync(typesReceipt.path, 'utf8'), typesReceipt.sha256)
    }
  }
  try {
    await runAssignmentListEphemeralLifecycle({ fixture: original, projectId, workdir: assignmentListProofWorkdir(projectId), migrations, mode: input.mode,
      expectedResources: assignmentListExpectedResources(projectId), reviewedManifestSha256: testOwnerDigest(JSON.stringify(original.manifest)),
      restorationPolicies: assignmentListRevocationPlans(original).map(plan => assignmentListRestorationPolicy(original, plan)) }, {
      ...native,
      async canonicalSnapshot(request) {
        const captured = await native.canonicalSnapshot(request), catalog = testOwnerCreateCanonicalTableCatalog(captured)
        if (canonicalTables) assert.deepEqual(catalog, canonicalTables)
        else { canonicalTables = catalog; expectedTables = classroomTestQuotaProofCatalog(catalog, migrations); canonicalSha256 = testOwnerDigest(JSON.stringify(captured)) }
        return captured
      },
      async command(request) { const result = await native.command(request); if (request.args[0] === 'status') target = validateAssignmentListProofTarget(result, projectId); return result },
      async executeSql(request) {
        await native.executeSql(request)
        if (request.sql === originalSetup) {
          assert(!session && target && expectedTables); session = { ...request }
          transport = createTestOwnerCreateProofTransport(f, target, projectId, fetch, sdkGuard)
          client = createClient<Database>(target.API_URL, target.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: transport.fetch } })
          await setup()
        }
      },
      async runCase(request) { const result = await native.runCase(request); if (!matrixComplete) await matrix(); return result },
    })
    assert(complete && matrixComplete && sqlComplete)
    process.stdout.write(`PASS isolated test-owner-create fourteen actual installed-SDK helper/RPC cases; eight committed pairs; exact restored raw42501 probe; rollback SQL contracts and nine two-session schedules.\n${cleanupMarker}`)
    return freeze({ types: typesReceipt ?? null, proof: { reviewedHead: input.head, manifestSha256: unionSha256, canonicalSha256,
      tableCatalogSha256: testOwnerDigest(JSON.stringify(expectedTables)), sdkCases: 14, sdkCreates: transport!.getVerifiedLedger().length,
      rpcRequests: transport!.counts.rpc, storageRequests: transport!.counts.storage, exchangeBytes: transport!.counts.exchangeBytes, native: nativeReceipt } })
  } catch (error) {
    const forced = testOwnerCreateForcedReceipt(input.mode, error, complete)
    if (forced) { process.stdout.write(forced.stdout); process.stderr.write(forced.stderr); process.exitCode = forced.exitCode; return }
    process.stderr.write(testOwnerCreateSetupDiagnostic(setupStage, error))
    if (sqlContracts) process.stderr.write(sqlContracts.diagnostic())
    if (transport) process.stderr.write(transport.diagnostic())
    throw Error('Test owner create lifecycle failed; private details withheld')
  } finally { if (originalPal === undefined) delete process.env.PAL_ENABLED; else process.env.PAL_ENABLED = originalPal }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) testOwnerCreateLifecycleMain().catch(() => {
  process.stderr.write('FAIL isolated test-owner-create lifecycle; private details withheld.\n'); process.exitCode = 1
})
