import { describe, expect, it } from 'vitest'
import { testOwnerDigest } from '../../scripts/contextual-test-owner-detail-proof-fixture'
import { AssignmentListLifecycleError } from '../../scripts/contextual-assignment-list-proof-lifecycle'
import { parseTestOwnerPublicationLifecycleArgs, testOwnerPublicationForcedReceipt,
  validateTestOwnerPublicationGeneratedTypes, testOwnerPublicationCanonicalTableCatalog,
  validateTestOwnerPublicationSnapshotCatalog, verifyTestOwnerPublicationPrivilegeRestoration,
  testOwnerPublicationMatrixCompletion } from '../../scripts/check-contextual-test-owner-publication-lifecycle'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPublicationFixture, TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES } from '../../scripts/contextual-test-publication-proof-fixture'

const generated = `export type Json = unknown;
export type Database = { public: { Functions: { publish_test_from_draft_for_owner_v1: {
Args: { p_actor_id: string; p_test_id: string; p_classroom_id: string;
p_expected_authoring_sha256: string; p_expected_draft_version: number;
p_validated_content: Json; p_deadline: string }; Returns: Json } } } }`

describe('closed publication lifecycle source', () => {
  it('accepts exactly the seven required genuine public RPC argument declarations', () => {
    expect(validateTestOwnerPublicationGeneratedTypes(generated, testOwnerDigest(generated))).toBe(true)
    expect(() => validateTestOwnerPublicationGeneratedTypes(generated, '0'.repeat(64))).toThrow()
  })
  it.each([
    generated.replace('p_actor_id: string', 'p_actor_id?: string'),
    generated.replace('p_expected_draft_version: number', 'p_expected_draft_version: string'),
    generated.replace('p_validated_content: Json', 'p_validated_content: unknown'),
    generated.replace('p_validated_content: Json', 'p_validated_content: string'),
    generated.replace('p_expected_authoring_sha256', 'p_expected_source_sha256'),
    generated.replace('p_deadline: string', 'p_deadline: string; extra: string'),
    generated.replace('Returns: Json', 'Returns: string'),
    generated.replace('public:', 'private:'),
    generated.replace('publish_test_from_draft_for_owner_v1', 'old_function'),
    generated.replace('export type Database', 'type Database'),
    generated.replace('Args:', 'Args?:'),
    `${generated}; export type Database = {}`,
    `// ${generated.replaceAll('\n', ' ')}`,
    `${generated}; /* unterminated`,
  ])('rejects malformed/optional/foreign generated declarations', source => {
    expect(() => validateTestOwnerPublicationGeneratedTypes(source, testOwnerDigest(source))).toThrow()
  })
  it('accepts only reviewed-head/mode arguments and normal-only type generation', () => {
    const args = ['--reviewed-head', 'a'.repeat(40), '--mode', 'normal']
    expect(parseTestOwnerPublicationLifecycleArgs(args)).toMatchObject({ generateTypes: false, mode: 'normal' })
    expect(parseTestOwnerPublicationLifecycleArgs([...args, '--generate-types'])).toMatchObject({ generateTypes: true })
    expect(() => parseTestOwnerPublicationLifecycleArgs([...args.slice(0, 3), 'after-fixture', '--generate-types'])).toThrow()
    expect(() => parseTestOwnerPublicationLifecycleArgs([...args, '--target', 'production'])).toThrow()
  })
  it.each(['after-fixture', 'before-capture'])('requires full setup, exact forced failure and clean teardown at %s', mode => {
    const e = new AssignmentListLifecycleError({ stage: mode, error: Error('Forced isolated lifecycle failure') }, [])
    expect(testOwnerPublicationForcedReceipt(mode, e, true)).toEqual({
      stdout: 'PASS isolated test-owner-publication exact teardown and unchanged canonical baseline.\n',
      stderr: `FAIL forced isolated test-owner-publication lifecycle: ${mode}.\n`, exitCode: 1,
    })
    expect(testOwnerPublicationForcedReceipt(mode, e, false)).toBeNull()
    expect(testOwnerPublicationForcedReceipt('normal', e, true)).toBeNull()
    expect(testOwnerPublicationForcedReceipt(mode, Error('Forced isolated lifecycle failure'), true)).toBeNull()
    expect(testOwnerPublicationForcedReceipt(mode, new AssignmentListLifecycleError(e.primary,
      [{ stage: 'teardown', error: Error('private cleanup failure') }]), true)).toBeNull()
  })
})

describe('publication completion and restoration admission', () => {
  const fixture = newTestOwnerPublicationFixture(newAssignmentListProofFixture())
  const tables = [...TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES, 'storage.objects', 'storage.buckets'].sort()
  const graph = () => ({ ...Object.fromEntries(TEST_OWNER_PUBLICATION_SNAPSHOT_TABLES.map(name => [name, []])),
    __nontarget_fingerprints: tables.map(table => ({ table, fingerprint: 'unchanged' })) })
  const catalog = () => JSON.stringify(Object.fromEntries(tables.map(table => [table, 'digest'])))
  it('derives the full canonical table closure without taking a new baseline', () => {
    expect(testOwnerPublicationCanonicalTableCatalog({ rowDigests: catalog() })).toEqual(tables)
    expect(Object.isFrozen(testOwnerPublicationCanonicalTableCatalog({ rowDigests: catalog() }))).toBe(true)
    expect(() => testOwnerPublicationCanonicalTableCatalog({ rowDigests: '{}' })).toThrow()
    expect(() => testOwnerPublicationCanonicalTableCatalog({ rowDigests: catalog().replace('storage.objects', 'foreign.objects') })).toThrow()
    expect(() => testOwnerPublicationCanonicalTableCatalog({ rowDigests: catalog().replace('storage.objects', 'storage.omitted') })).toThrow()
  })
  it('requires all fixture tables and exactly one fingerprint for every canonical table', () => {
    expect(validateTestOwnerPublicationSnapshotCatalog(graph(), tables)).toEqual(graph())
    const missing = graph(); missing.__nontarget_fingerprints.pop()
    expect(() => validateTestOwnerPublicationSnapshotCatalog(missing, tables)).toThrow()
    const duplicate = graph(); duplicate.__nontarget_fingerprints.push(duplicate.__nontarget_fingerprints[0])
    expect(() => validateTestOwnerPublicationSnapshotCatalog(duplicate, tables)).toThrow()
    expect(() => validateTestOwnerPublicationSnapshotCatalog({ ...graph(), extra: [] }, tables)).toThrow()
    expect(() => validateTestOwnerPublicationSnapshotCatalog(graph(), [...tables, tables[0]])).toThrow()
    const altered = graph(); altered.__nontarget_fingerprints[0] = { table: tables[0], fingerprint: '' }
    expect(() => validateTestOwnerPublicationSnapshotCatalog(altered, tables)).toThrow()
  })
  const restored = { privilegeRestored: true, fixtureUnchanged: true, snapshotAclSha256: 'a'.repeat(64) }
  it('returns restoration evidence only after a final whole-row comparison', async () => {
    const before = graph(); let captures = 0
    expect(await verifyTestOwnerPublicationPrivilegeRestoration(before, async () => { captures++; return graph() }, async () => restored)).toEqual(restored)
    expect(captures).toBe(1)
  })
  it.each([undefined, new Error('SDK failed')])('always captures rows after an ambiguous probe failure', async primary => {
    let captures = 0; let caught = false; let actual: unknown
    try { await verifyTestOwnerPublicationPrivilegeRestoration(graph(), async () => { captures++; return graph() }, async () => { throw primary }) }
    catch (error) { caught = true; actual = error }
    expect(caught).toBe(true); expect(actual).toBe(primary); expect(captures).toBe(1)
  })
  it('preserves both primary and final-snapshot failures', async () => {
    const primary = new Error('SDK failed'); const secondary = new Error('snapshot failed')
    await expect(verifyTestOwnerPublicationPrivilegeRestoration(graph(), async () => { throw secondary }, async () => { throw primary }))
      .rejects.toMatchObject({ errors: [primary, secondary] })
    await expect(verifyTestOwnerPublicationPrivilegeRestoration(graph(), async () => { const changed = graph(); changed.__nontarget_fingerprints[0].fingerprint = 'changed'; return changed }, async () => restored))
      .rejects.toThrow('Application restoration rows changed')
  })
  it.each([
    { ...restored, privilegeRestored: false }, { ...restored, fixtureUnchanged: false },
    { ...restored, snapshotAclSha256: 'invalid' },
  ])('rejects incomplete capability restoration receipts', async receipt => {
    await expect(verifyTestOwnerPublicationPrivilegeRestoration(graph(), async () => graph(), async () => receipt)).rejects.toThrow()
  })
  function completionTransport() {
    const labels = [...fixture.privilegeProbes, ...fixture.cases].map(c => c.label)
    const ledger = Object.freeze([...fixture.transitions.map(c => ({ kind: 'transition', caseLabel: c.label, state: 'verified' })),
      ...fixture.cases.filter(c => c.expectedHTTP === 200).map(c => ({ kind: 'publication', caseLabel: c.label, state: 'verified' }))])
    const completion = Object.freeze({ complete: true, verifiedContextLabels: labels, verifiedTransitionLabels: fixture.transitions.map(c => c.label) })
    return { labels, value: { getVerifiedLedger: () => ledger, counts: { rpc: 20, network: 20, storage: 0 },
      evidence: { rawPrivilegeFailures: 4, rawPrivilegeContexts: fixture.privilegeProbes.map(c => c.context).sort() }, completion: () => completion } }
  }
  // These deliberately incomplete offline doubles exercise the coordinator's
  // completion checks only. Native-issued full-row witnesses are tested by the
  // fixture and transport suites and are mandatory in an actual execution.
  const complete = (value: unknown, labels: readonly string[]) => testOwnerPublicationMatrixCompletion(fixture,
    value as Parameters<typeof testOwnerPublicationMatrixCompletion>[1], labels)
  it('requires exact SDK and committed inventories and completed sealed evidence', () => {
    const { value, labels } = completionTransport()
    expect(complete(value, labels)).toEqual({ sdkCases: 10, sdkPublications: 3, rpcRequests: 20, storageRequests: 0, verifiedEffects: 8 })
    expect(() => complete(value, [...labels].reverse())).toThrow()
    expect(() => complete({ ...value, completion: () => Object.freeze({ ...value.completion(), complete: false }) }, labels)).toThrow()
    expect(() => complete({ ...value, completion: () => ({ ...value.completion() }) }, labels)).toThrow()
    expect(() => complete({ ...value, completion: () => Object.freeze({ ...value.completion(), verifiedTransitionLabels: [] }) }, labels)).toThrow()
    expect(() => complete({ ...value, getVerifiedLedger: () => Object.freeze(value.getVerifiedLedger().slice(1)) }, labels)).toThrow()
    expect(() => complete({ ...value, counts: { ...value.counts, storage: 1 } }, labels)).toThrow()
    expect(() => complete({ ...value, evidence: { ...value.evidence, rawPrivilegeFailures: 3 } }, labels)).toThrow()
  })
})
