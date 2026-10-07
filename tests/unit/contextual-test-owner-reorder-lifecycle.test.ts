import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerReorderFixture, TEST_OWNER_REORDER_SNAPSHOT_TABLES, testOwnerReorderTableCatalogFromCanonical } from '../../scripts/contextual-test-reorder-proof-fixture'
import {
  parseTestOwnerReorderLifecycleArgs, testOwnerReorderForcedReceipt, validateTestOwnerReorderGeneratedTypes,
  testOwnerReorderUnionManifest, testOwnerReorderMatrixCompletion, validateTestOwnerReorderSnapshotCatalog,
  testOwnerReorderSetupDiagnostic, testOwnerReorderCommittedCompletion,
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
    expect(union.sql.contracts.contracts).toHaveLength(9); expect(union.sql.concurrency.schedules).toHaveLength(21)
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
    expect(source).toContain('appBytes + nativeByteReserve + (transport?.counts.exchangeBytes ?? 0) <= APP_CAPS.totalBytes')
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
