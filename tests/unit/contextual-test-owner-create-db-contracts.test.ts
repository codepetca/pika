import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerCreateFixture } from '../../scripts/contextual-test-owner-create-proof-fixture'
import { TEST_OWNER_CREATE_DB_CAPS, TEST_OWNER_CREATE_FAILURE_LABELS, testOwnerCreateContractsManifest } from '../../scripts/contextual-test-owner-create-db-contracts'

const f = newTestOwnerCreateFixture(newAssignmentListProofFixture(new Date('2026-10-06T03:30:00Z')))
const manifest = testOwnerCreateContractsManifest(f)

describe('contextual Test owner-create rollback database contracts', () => {
  it('returns a deterministic deeply frozen finite manifest', () => {
    expect(testOwnerCreateContractsManifest(f)).toEqual(manifest)
    expect(manifest).toMatchObject({ version: 1, caps: { sqlBytes: 256 * 1024, actionMs: 35_000, requestMs: 12_000 } })
    expect(Object.isFrozen(manifest)).toBe(true)
    expect(Object.isFrozen(manifest.caps)).toBe(true)
    expect(Buffer.byteLength(manifest.contracts)).toBeLessThanOrEqual(TEST_OWNER_CREATE_DB_CAPS.sqlBytes)
    expect(Buffer.byteLength(manifest.catalogAndPlan)).toBeLessThanOrEqual(TEST_OWNER_CREATE_DB_CAPS.sqlBytes)
  })

  it('is one rollback-only transaction with a single bounded evidence result', () => {
    const sql = manifest.contracts
    expect(sql.trimStart()).toMatch(/^begin;/i)
    expect(sql.trimEnd()).toMatch(/rollback;$/i)
    expect(sql).not.toMatch(/\bcommit\s*;|truncate\s|reset\s+.*sequence|setval\s*\(/i)
    expect(sql.match(/\bas result\b/gi)).toHaveLength(1)
    expect(sql).toContain("set local statement_timeout='35s'")
    expect(sql).toContain("set local lock_timeout='1s'")
    expect(sql).toContain('pg_temp.owner_create_snapshot()')
    expect(sql).toContain('Exact fixture rows changed between rollback probes')
    expect(sql).toContain("'native_execution',true")
  })

  it('attests the exact catalog, ACL, defaults, index and trigger chain', () => {
    const sql = manifest.contracts
    for (const token of [
      'create_test_for_owner_v1(uuid,uuid,text,timestamp with time zone)', 'prosecdef', 'search_path=""', 'lock_timeout=1s',
      "has_function_privilege('service_role'", "has_function_privilege('anon'", "has_function_privilege('authenticated'",
      'idx_tests_classroom_position_owner_create', 'indisunique', 'indisvalid', 'indisready',
      'assign_test_default_gradebook_category', 'car_tests', 'classroom_purge_fence_tests', 'tests_managed_storage_sync',
      'enqueue_obsolete_test_document_snapshots', 'preserve_test_question_lock', 'tests_blueprint_purge_lineage_fence',
      'tests_managed_storage_remove', 'touch_classroom_blueprint_source_from_tests_update', 'update_tests_updated_at',
      'touch_classroom_blueprint_source_from_tests_insert_delete', 'car_assessment_drafts',
      'classroom_purge_fence_assessment_drafts', 'touch_classroom_blueprint_source_from_drafts',
      'update_assessment_drafts_updated_at', 'Exact noninternal trigger closure differs', 'Trigger enable/deferral mode differs',
      'format_type', 'Exact Test constraints differ', 'Exact draft constraints differ',
      "array['id','classroom_id','title','status','show_results','position','points_possible','include_in_final','created_by','created_at','updated_at','documents','artifact_id','source_artifact_id','blueprint_archived_at','source_blueprint_version_id','questions_locked_at','gradebook_category_id','gradebook_weight','gradebook_maximum_override','gradebook_score_scale']",
      "array['id','assessment_type','assessment_id','classroom_id','content','version','created_by','updated_by','created_at','updated_at']",
    ]) expect(sql).toContain(token)
  })

  it('includes existing gradebook deletion and removed-academic parent triggers in the exact closure', () => {
    const sql = manifest.contracts
    // Immutable157/173 plus dormant253 define an exact18-trigger closure.
    expect(sql.includes("('tests','delete_test_gradebook_score_overrides','public','delete_gradebook_overrides_for_assessment',9)")).toBe(true)
    expect(sql.includes("('tests','removed_academic_parent','private','guard_removed_academic_parent',27)")).toBe(true)
    expect(sql.match(/\('(?:tests|assessment_drafts)','[a-z_]+','(?:public|private)','[a-z_0-9]+',\d+\)/g)).toHaveLength(36)
    expect(sql).toContain('Exact noninternal trigger closure differs')
  })

  it('covers success, bounds, authority, maintenance, drift and exact rollback labels', () => {
    const sql = manifest.contracts
    for (const label of [
      'student-owner-create', 'teacher-owner-create', 'bulk-1001-retired-max', 'uncategorized-fallback', 'custom-category-default',
      'position-intmax', 'invalid-null-title', 'invalid-blank-title', 'invalid-long-title', 'invalid-deadline', 'expired-deadline', 'wrong-owner', 'missing-classroom',
      'archived-owner', 'restore-fence', 'compaction-fence', 'identity-fence', 'known-55000', 'unknown-55000', 'raw-42501',
      'suppress-test', 'fail-test', 'suppress-draft', 'fail-draft', 'drift-test-before', 'drift-test-after', 'drift-draft-before',
      'drift-draft-after', 'drift-test-identity', 'drift-draft-identity', 'drift-defaults', 'drift-parent', 'drift-revisions', 'drift-settings', 'drift-category',
      'deadline-after-test', 'deadline-after-draft',
      'hot-purge-fence-state', 'cold-purge-fence-state', 'attendance-decommission-fenced',
      'attendance-decommission-remote_deleted', 'attendance-decommission-local_deleted',
    ]) expect(sql).toContain(label)
    expect(sql).toContain("pg_catalog.pg_sleep(0.1)")
    expect(sql.match(/create temp sequence owner_create_[a-f0-9]{12}_deadline_after_(?:test|draft)_hit;/g)).toHaveLength(2)
    expect(sql.match(/pg_catalog\.nextval\('pg_temp\.owner_create_[a-f0-9]{12}_deadline_after_(?:test|draft)_hit'::regclass\)/g)).toHaveLength(2)
    expect(sql.match(/pg_catalog\.currval\('pg_temp\.owner_create_[a-f0-9]{12}_deadline_after_(?:test|draft)_hit'::regclass\)/g)).toHaveLength(2)
    expect(sql).not.toMatch(/\bsetval\s*\(|\balter\s+sequence\b|\brestart\s+(?:with\s+)?\d/i)
    expect(sql).toContain('blueprint_source_revision')
    expect(sql).toContain("archive_before + 4")
    expect(sql).toContain("position')::integer is distinct from pos+1")
    expect(sql).not.toMatch(/owner_create_assert_pair\([^;]+,1000,bp,ar,settings,category\)/)
    expect(sql).toContain('limit 1001')
    for (const id of [...f.actors.map(a => a.id), ...f.classes.map(c => c.id), f.missingClassroomId]) expect(sql).toContain(id)
  })

  it('covers actual rollback-only lifecycle states while keeping concurrent races deferred', () => {
    expect(manifest.remainingNativeObligations).toEqual([
      'hot/cold purge and attendance-decommission concurrent races (single-transaction lifecycle row states are covered here)',
      'settings/classroom/revision/actor/category/advisory held-lock races',
      'two-session create serialization and legacy stale-MAX interaction',
      'whole-project external pre/post rollback equality and installed-SDK execution',
    ])
    expect(manifest.catalogAndPlan).toContain('explain (format json, costs false)')
    expect(manifest.catalogAndPlan).toContain('order by test.position desc,test.id desc limit 1')
    expect(manifest.catalogAndPlan).not.toMatch(/\b(insert|update|delete|alter|drop|grant|revoke)\b/i)
    expect(manifest.catalogAndPlan).toMatch(/^begin;/)
    expect(manifest.catalogAndPlan).toContain('create function pg_temp.owner_create_explain()')
    expect(manifest.catalogAndPlan).not.toContain('set transaction read only;')
    expect(manifest.catalogAndPlan).toContain("'plan',pg_temp.owner_create_explain()")
    expect(manifest.catalogAndPlan.match(/\bas result\b/gi)).toHaveLength(1)
  })

  it('uses SQL conditional syntax and exact column sets rather than invented physical order', () => {
    expect(manifest.contracts).not.toMatch(/pg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i)
    expect(manifest.contracts).toContain('array_agg(a.attname::text order by a.attname::text collate "C")')
    expect(manifest.contracts).toContain('array_agg(column_name order by column_name collate "C")')
    expect(manifest.contracts).toContain('actual is distinct from')
  })

  it('limits every fault trigger to the exact synthetic Class and case title', () => {
    const starts = manifest.contracts.match(/create function private\.zzz_owner_create_probe_[^\n]+/g) ?? []
    expect(starts).toHaveLength(20)
    for (const sql of starts) {
      expect(sql).toContain(`new.classroom_id is distinct from '${f.classes[0].id}'::uuid`)
      expect(sql).toMatch(/new\.(?:title|content->>'title') is distinct from 'testownercreate_[a-f0-9]{12} [a-z0-9-]+'/)
      expect(sql).toContain('then return new;end if;')
    }
  })

  it('checks index ordering from catalog flags, not column-only index decompilation', () => {
    expect(manifest.contracts).toContain('i.indnkeyatts=3')
    expect(manifest.contracts).toContain('i.indnatts=3')
    expect(manifest.contracts).toContain('i.indoption[0]=0')
    expect(manifest.contracts).toContain('i.indoption[1]=3')
    expect(manifest.contracts).toContain('i.indoption[2]=3')
    expect(manifest.contracts).toContain('i.indpred is null')
    expect(manifest.contracts).toContain('i.indexprs is null')
    expect(manifest.contracts).not.toMatch(/pg_get_indexdef\([^\n]+,\s*[23],true\)[^\n]*DESC/)
    expect(manifest.contracts).not.toContain('249_contextual_test_owner_create')
  })
  it('uses actual whitespace and finite private failure codes without weakening assertions', () => {
    expect(manifest.contracts.includes("' \t\n'")).toBe(true)
    expect(Object.isFrozen(TEST_OWNER_CREATE_FAILURE_LABELS)).toBe(true)
    expect(Object.keys(TEST_OWNER_CREATE_FAILURE_LABELS).length).toBeLessThan(100)
    expect(Object.keys(TEST_OWNER_CREATE_FAILURE_LABELS).every(code => /^PC\d{3}$/.test(code))).toBe(true)
    for (const [code, label] of Object.entries(TEST_OWNER_CREATE_FAILURE_LABELS)) {
      expect(/^[a-z0-9_-]{1,80}$/.test(label)).toBe(true)
      expect(manifest.contracts.includes(`errcode='${code}'`)).toBe(true)
    }
  })
})
