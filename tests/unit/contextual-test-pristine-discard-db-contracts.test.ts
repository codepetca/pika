import { describe, expect, it } from 'vitest'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestOwnerPristineDiscardFixture } from '../../scripts/contextual-test-pristine-discard-proof-fixture'
import { TEST_OWNER_PRISTINE_DISCARD_DB_CAPS, TEST_OWNER_PRISTINE_DISCARD_DB_CHECK_LABELS, TEST_OWNER_PRISTINE_DISCARD_FAILURE_LABELS,
  testOwnerPristineDiscardDbContractsSql, testOwnerPristineDiscardDbPlanObjectIds } from '../../scripts/contextual-test-pristine-discard-db-contracts'

const f = newTestOwnerPristineDiscardFixture(newAssignmentListProofFixture(new Date('2026-10-06T03:00:00Z')))
const project = `pika_assignment_list_${f.tag.slice(-12)}`
const sql = testOwnerPristineDiscardDbContractsSql(f, project)

describe('contextual pristine Test discard rollback database contracts', () => {
  it('is one finite rollback-only bundle with closed diagnostics', () => {
    expect(Buffer.byteLength(sql)).toBeLessThanOrEqual(TEST_OWNER_PRISTINE_DISCARD_DB_CAPS.sqlBytes)
    expect(TEST_OWNER_PRISTINE_DISCARD_DB_CAPS).toEqual({ sqlBytes: 256 * 1024, actionMs: 35_000, requestMs: 12_000 })
    expect(sql.trimStart()).toMatch(/^begin;/i); expect(sql.trimEnd()).toMatch(/rollback;$/i)
    expect(sql).toContain("set local statement_timeout='35s'"); expect(sql).toContain("set local lock_timeout='1s'")
    expect(sql).not.toMatch(/\bcommit\s*;|truncate\s|setval\s*\(|reset\s+.*sequence/i)
    expect(sql.match(/\bas result\b/gi)).toHaveLength(1)
    expect(Object.isFrozen(TEST_OWNER_PRISTINE_DISCARD_FAILURE_LABELS)).toBe(true)
    for (const [code, label] of Object.entries(TEST_OWNER_PRISTINE_DISCARD_FAILURE_LABELS)) {
      expect(code).toMatch(/^PCD\d{2}$/); expect(label).toMatch(/^[a-z0-9_-]{1,80}$/); expect(sql).toContain(`errcode='${code}'`)
    }
    expect(TEST_OWNER_PRISTINE_DISCARD_DB_CHECK_LABELS).toHaveLength(Object.keys(TEST_OWNER_PRISTINE_DISCARD_FAILURE_LABELS).length - 2)
  })

  it('attests exact service-only RPCs,17 triggers,nine CASCADE Test FKs and the partial managed-resource index', () => {
    for (const token of ['discard_pristine_test_draft_for_owner_v1(uuid,uuid,integer,timestamp with time zone,timestamp with time zone)',
      'discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamp with time zone)', 'prosecdef', 'search_path=""', 'lock_timeout=1s',
      "has_function_privilege('service_role'", "has_function_privilege('anon'", "has_function_privilege('authenticated'",
      'delete_test_gradebook_score_overrides', 'removed_academic_parent', 'tests_managed_storage_remove',
      'touch_classroom_blueprint_source_from_drafts', 'Exact17 trigger closure differs',
      'test_questions_test_id_fkey', 'test_attempts_test_id_fkey', 'test_responses_test_id_fkey', 'test_focus_events_test_id_fkey',
      'test_student_availability_test_id_fkey', 'test_ai_grading_runs_test_id_fkey', 'test_ai_grading_run_items_test_id_fkey',
      'managed_storage_json_references_test_id_fkey', 'classroom_guided_draft_provenance_test_id_fkey', "confdeltype='c'", "method<>'btree'",
      'idx_managed_storage_test_resource_owner_discard', "resource_type = ''test''::text", 'indpred', 'indisvalid', 'indisready']) expect(sql).toContain(token)
    expect(sql).toContain('explain (format json, costs false)')
    expect(sql).toContain('resource_id=')
    expect(testOwnerPristineDiscardDbPlanObjectIds(f)).toHaveLength(1001)
    expect(sql).toContain("'managed_resource_plan_fixture_count',1001")
    expect(sql).toContain("'test_columns'"); expect(sql).toContain("'draft_columns'")
  })

  it('executes every fixed case without inventing a version-one/full250 eligibility predicate', () => {
    for (const c of f.cases) { expect(sql).toContain(c.label); expect(sql).toContain(c.actorId); expect(sql).toContain(c.testId) }
    expect(sql).toContain('later-version-pristine')
    expect(sql).not.toMatch(/question_identity_version[^\n]+(?:=|is distinct from)\s*1|source_format[^\n]+markdown/i)
    expect(sql).toContain("r->>'discarded' is distinct from 'true'"); expect(sql).toContain("r->>'reason' is distinct from 'draft_changed'")
    expect(sql).toContain('blueprint_source_revision'); expect(sql).toContain('archive_before.revision + 4')
    expect(sql).toContain('pg_catalog.transaction_timestamp()')
  })

  it('covers every nondestructive child blocker and preserves immutable/queue/settings scopes', () => {
    for (const table of ['test_questions','test_attempts','test_responses','test_focus_events','test_student_availability',
      'test_ai_grading_runs','test_ai_grading_run_items','managed_storage_json_references','classroom_guided_draft_provenance',
      'gradebook_score_overrides','managed_storage_objects','test_document_snapshot_storage_cleanup']) expect(sql).toContain(`public.${table}`)
    expect(sql).toContain('classroom_retired_assessment_records')
    expect(sql).toContain('course_blueprint_versions')
    expect(sql).toContain('managed_storage_settings')
    expect(sql).not.toMatch(/\b(?:insert into|update|delete from) storage\./i)
  })

  it('proves delete suppression/reinsertion, drift, deadline reach and closed unknown failures', () => {
    for (const label of ['suppress-draft-delete','suppress-test-delete','reinsert-draft-after-delete','reinsert-test-after-delete',
      'wrong-draft-binding','drift-settings','drift-revision','fence-archive-restore','fence-archive-compaction','fence-identity-mapping',
      'fence-classroom-purge-finalize','fence-blueprint-purge-finalize','fence-student-purge-finalize',
      'deadline-after-draft-delete','deadline-after-test-delete','known-classroom-purge-active','known-attendance-decommission-active',
      'known-attendance-decommission-irreversible','known-academic-cleanup-parent-fenced','unknown-55000','raw-42501']) expect(sql).toContain(label)
    expect(sql).toContain('create temp sequence')
    expect(sql).toContain('pg_catalog.nextval'); expect(sql).toContain('pg_catalog.currval'); expect(sql).toContain('pg_catalog.pg_sleep(0.1)')
    expect(sql).not.toMatch(/\bsetval\s*\(|\balter\s+sequence\b|\brestart\s+(?:with\s+)?\d/i)
  })
})
