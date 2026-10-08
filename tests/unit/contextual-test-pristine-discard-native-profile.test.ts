import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPristineDiscardFixture } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { buildDraftSaveNativeContractsManifest, buildTestOwnerPristineDiscardNativeContractsManifest,
  validateTestOwnerPristineDiscardNativeSql, createTestOwnerPristineDiscardNativeContracts,
  validateTestOwnerPristineDiscardManagedPlan } from '../../scripts/contextual-test-draft-save-native-contracts'

const original = newAssignmentListProofFixture(new Date('2026-10-06T03:00:00Z'))
const fixture = newTestOwnerPristineDiscardFixture(original)
const head = 'dba18a9e167a9a7cd296ecffdbfb54da9c206e89'
describe('closed migration251 native profile source', () => {
  it('selects two fixed different capabilities under unchanged shared engine limits', () => {
    const manifest = buildTestOwnerPristineDiscardNativeContractsManifest(original, fixture, head, process.cwd())
    const legacy = buildDraftSaveNativeContractsManifest(original, head, process.cwd())
    expect(manifest.capabilities).toEqual(legacy.capabilities)
    expect(manifest.privilege.revoke).toContain('discard_pristine_test_draft_for_owner_v1(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)')
    expect(manifest.innerPrivilege.revoke).toContain('discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamp with time zone)')
    expect(manifest.privilege.revoke).not.toContain('discard_pristine_test_draft_atomic')
    expect(manifest.setup).not.toMatch(/\b(insert|update|delete|commit)\b/i)
    expect(Object.isFrozen(manifest.innerPrivilege)).toBe(true)
    expect(manifest.concurrency.schedules).toHaveLength(14)
  })
  it('admits only literal reviewed SQL, never restoration as ordinary work or a caller profile', () => {
    const manifest = buildTestOwnerPristineDiscardNativeContractsManifest(original, fixture, head, process.cwd())
    for (const sql of [manifest.setup, manifest.snapshot, manifest.contracts.contracts, manifest.privilege.catalog,
      manifest.privilege.revoke, manifest.innerPrivilege.catalog, manifest.innerPrivilege.revoke,
      ...manifest.concurrency.schedules.flatMap(s => [s.holderSql, s.observeSql, s.rejectSql])]) {
      expect(validateTestOwnerPristineDiscardNativeSql(manifest, sql)).toBe(true)
      expect(validateTestOwnerPristineDiscardNativeSql(manifest, `${sql} select 1;`)).toBe(false)
    }
    for (const sql of [manifest.privilege.restore, manifest.innerPrivilege.restore, 'delete from public.users;'])
      expect(validateTestOwnerPristineDiscardNativeSql(manifest, sql)).toBe(false)
    expect(typeof createTestOwnerPristineDiscardNativeContracts).toBe('function')
    let error: unknown
    try { buildTestOwnerPristineDiscardNativeContractsManifest(original, {...fixture, tests: []}, head, process.cwd()) }
    catch (e) { error = e }
    expect(error instanceof Error && error.message === 'Test pristine-discard fixture differs').toBe(true)
    expect(() => buildTestOwnerPristineDiscardNativeContractsManifest(original, fixture, 'main', process.cwd())).toThrow()
  })
  it('requires actual selective managed-resource index evidence, not DDL, empty scans or unknown nodes', () => {
    const test = fixture.cases.find(c => c.label === 'restored-privilege-success')!
    const condition = `(resource_id = '${test.testId}'::uuid)`
    const scan = {'Node Type':'Index Scan','Parallel Aware':false,'Async Capable':false,'Scan Direction':'Forward',
      'Index Name':'idx_managed_storage_test_resource_owner_discard','Relation Name':'managed_storage_objects',
      Alias:'managed_storage_objects','Index Cond':condition}
    const plan = [{Plan:scan}]
    expect(validateTestOwnerPristineDiscardManagedPlan(plan, fixture)).toBe(true)
    const bitmap = [{Plan:{'Node Type':'Bitmap Heap Scan','Parallel Aware':false,'Async Capable':false,
      'Relation Name':'managed_storage_objects',Alias:'managed_storage_objects','Recheck Cond':`(${condition} AND (resource_type = 'test'::text))`,
      Plans:[{'Node Type':'Bitmap Index Scan','Parent Relationship':'Outer','Parallel Aware':false,'Async Capable':false,
        'Index Name':scan['Index Name'],'Index Cond':condition}]}}]
    expect(validateTestOwnerPristineDiscardManagedPlan(bitmap, fixture)).toBe(true)
    for (const bad of [null, [], 'CREATE INDEX ...', [{Plan:{...scan,'Node Type':'Seq Scan'}}],
      [{Plan:{...scan,'Index Name':'different_index'}}], [{Plan:{...scan,'Index Cond':'true'}}],
      [{Plan:{...scan,Filter:'true'}}], [{Plan:{...scan,'Scan Direction':'Backward'}}],
      [{Plan:{...bitmap[0].Plan,Plans:[]}}], [{Plan:{...bitmap[0].Plan,'Recheck Cond':'true'}}]])
      expect(() => validateTestOwnerPristineDiscardManagedPlan(bad, fixture)).toThrow()
  })
})
