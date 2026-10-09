import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const path = resolve(process.cwd(), 'supabase/migrations/252_contextual_test_owner_publication.sql')
const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
const code = source.replace(/--[^\n]*/g, '')

describe('contextual current-owner Test publication SQL source contract', () => {
  it('is one additive transaction with an exact service-only seven-argument RPC', () => {
    expect(code.trim()).toMatch(/^begin;/)
    expect(code.trim()).toMatch(/commit;$/)
    expect(code).toMatch(/create function public\.publish_test_from_draft_for_owner_v1\(\s*p_actor_id uuid, p_test_id uuid, p_classroom_id uuid,\s*p_expected_authoring_sha256 text, p_expected_draft_version integer,\s*p_validated_content jsonb, p_deadline timestamptz\s*\)/)
    expect(code).toMatch(/security definer\s+set search_path = ''\s+set lock_timeout = '1s'/)
    expect(code).toMatch(/revoke all on function public\.publish_test_from_draft_for_owner_v1\(uuid,uuid,uuid,text,integer,jsonb,timestamptz\)\s+from public, anon, authenticated/)
    expect(code).toMatch(/grant execute on function public\.publish_test_from_draft_for_owner_v1\(uuid,uuid,uuid,text,integer,jsonb,timestamptz\)\s+to service_role/)
    expect(code).not.toMatch(/grant .* to (?:anon|authenticated|public)\b/)
  })

  it('uses finite content/result/state bounds and one cumulative deadline', () => {
    expect(code).toContain("p_expected_authoring_sha256 !~ '^[a-f0-9]{64}$'")
    expect(code).toContain('pg_catalog.octet_length(p_validated_content::text) > 2097152')
    expect(code).toContain("pg_catalog.clock_timestamp() + interval '8 seconds'")
    expect(code).toContain("pg_catalog.clock_timestamp() + interval '20 seconds'")
    expect(code).toContain('v_question_count > 10000')
    expect(code).toContain('v_state_bytes > 67108864')
    expect(code).toContain('v_state_bytes + v_post_state_bytes > 67108864')
    expect(code).toContain('pg_catalog.to_jsonb(v_test_before)::text) > 2097152')
    expect(code).toContain('pg_catalog.to_jsonb(v_test_after)::text) > 2097152')
    expect(code).toContain('pg_catalog.octet_length(v_result::text) > 8388608')
    expect(code.match(/pg_catalog\.clock_timestamp\(\) >= v_phase_deadline/g)?.length).toBeGreaterThanOrEqual(5)
  })

  it('follows the modern settings and Classroom operation lock order', () => {
    const settings = code.indexOf('from public.managed_storage_settings settings')
    const testAdvisory = code.indexOf('pg_catalog.pg_try_advisory_xact_lock')
    const operation = code.indexOf('public.classroom_purge_try_lock(v_classroom_id)')
    const membership = code.indexOf('private.try_lock_classroom_membership_change(v_classroom_id)')
    const classroom = code.indexOf('from public.classrooms classroom', membership)
    const archive = code.indexOf('from public.classroom_archive_revisions revision')
    const test = code.indexOf('from public.tests test', archive)
    const draft = code.indexOf('from public.assessment_drafts draft', test)
    expect(settings).toBeGreaterThan(-1)
    expect(testAdvisory).toBeGreaterThan(settings)
    expect(operation).toBeGreaterThan(testAdvisory)
    expect(membership).toBeGreaterThan(operation)
    expect(classroom).toBeGreaterThan(membership)
    expect(archive).toBeGreaterThan(classroom)
    expect(test).toBeGreaterThan(archive)
    expect(draft).toBeGreaterThan(test)
    expect(code).toContain('where settings.singleton for share nowait')
    expect(code).toContain('for update nowait')
  })

  it('binds fixed Class, authoring digest, exact version, and canonical stored JSON', () => {
    expect(code).toContain('private.test_draft_owner_source_v1(p_actor_id,p_test_id,p_classroom_id')
    expect(code).toContain("v_source->>'source_sha256' is distinct from p_expected_authoring_sha256")
    expect(code).toContain('v_draft_before.version is distinct from p_expected_draft_version')
    expect(code).toContain('p_validated_content is distinct from v_draft_before.content')
    expect(code).toContain("v_test_before.status is distinct from 'draft'")
    expect(code).toContain('v_test_before.questions_locked_at is not null')
    expect(code).toContain('v_test_before.blueprint_archived_at is not null')
  })

  it('fails closed on complete physical row shapes and captures full private preimages', () => {
    expect(code).toContain("'public.tests'::pg_catalog.regclass")
    expect(code).toContain("'public.assessment_drafts'::pg_catalog.regclass")
    expect(code).toContain("'public.test_questions'::pg_catalog.regclass")
    expect(code).toContain("'gradebook_maximum_override'")
    expect(code).toContain("'ai_reference_cache_generated_at'")
    expect(code).toContain('pg_catalog.to_jsonb(v_test_before)')
    expect(code).toContain('pg_catalog.to_jsonb(v_draft_before)')
    expect(code).toContain('pg_catalog.jsonb_agg(pg_catalog.to_jsonb(question) order by question.id)')
    expect(code).toContain('from public.classroom_guided_draft_provenance provenance')
  })

  it('blocks every Test-wide learner/grading association before delegation', () => {
    for (const table of [
      'test_attempts', 'test_responses', 'test_student_availability', 'test_focus_events',
      'test_ai_grading_runs', 'test_ai_grading_run_items',
    ]) expect(code.match(new RegExp(`from public\\.${table} where test_id = p_test_id`, 'g'))).toHaveLength(2)
    expect(code.match(/from public\.gradebook_score_overrides(?:\s+)?where assessment_type = 'test' and assessment_id = p_test_id/g)).toHaveLength(2)
    expect(code).not.toContain("classroom_id = v_classroom_id and assessment_type = 'test'")
    expect(code.indexOf('test_publication_has_dependent_work')).toBeLessThan(
      code.indexOf('public.publish_test_from_draft_atomic('),
    )
  })

  it('respects lifecycle/provider fences and both nested service capabilities', () => {
    expect(code).toContain("public.is_classroom_archive_maintenance_mode('restore')")
    expect(code).toContain("public.is_classroom_archive_maintenance_mode('compaction')")
    for (const setting of [
      'pika.identity_mapping', 'pika.classroom_purge_finalize',
      'pika.course_blueprint_purge_finalize', 'pika.student_purge_finalize',
    ]) expect(code).toContain(`'${setting}'`)
    expect(code.match(/perform public\.guard_classroom_purge_lifecycle\(v_classroom_id\)/g)).toHaveLength(2)
    expect(code).toContain('private.student_provider_cleanup_bindings')
    expect(code).toContain("'public.publish_test_from_draft_atomic(uuid,uuid,integer)'")
    expect(code).toContain("'public.activate_test_from_draft_atomic(uuid,uuid,integer)'")
    expect(code.match(/has_function_privilege\('service_role'/g)).toHaveLength(2)
  })

  it('delegates the existing mutation algorithm exactly once and performs no competing DML', () => {
    expect(code.match(/v_legacy_result := public\.publish_test_from_draft_atomic\(/g)).toHaveLength(1)
    expect(code).not.toMatch(/\b(?:insert into|update|delete from) public\.(?:tests|test_questions|assessment_drafts)\b/)
    expect(code).toContain("v_legacy_result->>'draft_version'")
    expect(code).toContain("v_test_after.status is distinct from 'closed'")
  })

  it('proves complete question identities, postimages, and exact revision effects', () => {
    expect(code).toContain('v_question_insert_count')
    expect(code).toContain('v_question_update_count')
    expect(code).toContain('v_question_delete_count')
    expect(code).toMatch(/v_classroom_before\.blueprint_source_revision\s*\+ v_test_source_delta \+ v_question_change_count/)
    expect(code).toContain('v_archive_before.revision + 2 + v_test_source_delta + 2 * v_question_change_count')
    expect(code).toContain("pg_catalog.to_jsonb(after_question) - array[")
    expect(code).toContain("coalesce(after_question.source_artifact_id,after_question.artifact_id)")
    expect(code).toContain("after_question.ai_reference_cache_key is not null")
    expect(code).toContain('v_provenance_after is distinct from v_provenance_before')
    expect(code).toContain('pg_catalog.to_jsonb(v_settings_after) is distinct from pg_catalog.to_jsonb(v_settings_before)')
    expect(code).toContain('v_managed_refs_after is distinct from v_managed_refs_before')
    expect(code).toContain('v_managed_objects_after is distinct from v_managed_objects_before')
    expect(code).toContain('v_document_cleanup_after is distinct from v_document_cleanup_before')
    expect(code).toContain("after_question.id::text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4")
  })

  it('returns only the strict server witness and closes contention without broad privilege mapping', () => {
    expect(code).toContain("pg_catalog.jsonb_build_object('version',1,'actor_id',p_actor_id,'classroom_id',p_classroom_id,")
    expect(code).toContain("'test_id',p_test_id,'source_sha256',p_expected_authoring_sha256,")
    expect(code).toContain("'draft_version',p_expected_draft_version,'test',pg_catalog.to_jsonb(v_test_after))")
    const result = code.slice(code.indexOf("v_result := pg_catalog.jsonb_build_object('version',1"))
    expect(result).not.toMatch(/'draft'|'questions'|'provenance'|'settings'/)
    expect(code).toContain('when lock_not_available or deadlock_detected or serialization_failure then')
    expect(code).not.toMatch(/when others|when insufficient_privilege/)
  })
})
