import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const path = resolve(process.cwd(), 'supabase/migrations/250_contextual_test_owner_create.sql')
const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
const code = source.replace(/--[^\n]*/g, '')

describe('contextual empty Test creation SQL source contract', () => {
  it('is one additive transaction with a narrowly granted entrypoint', () => {
    expect(code.trim()).toMatch(/^begin;/)
    expect(code.trim()).toMatch(/commit;$/)
    expect(code).toMatch(/create function public\.create_test_for_owner_v1\(\s*p_actor_id uuid, p_classroom_id uuid, p_title text, p_deadline timestamptz\s*\)/)
    expect(code).toMatch(/security definer\s+set search_path = ''\s+set lock_timeout = '1s'/)
    expect(code).toMatch(/revoke all on function public\.create_test_for_owner_v1\(uuid,uuid,text,timestamptz\)\s+from public, anon, authenticated/)
    expect(code).toMatch(/grant execute on function public\.create_test_for_owner_v1\(uuid,uuid,text,timestamptz\)\s+to service_role/)
    expect(code).not.toMatch(/grant .* to (?:anon|authenticated|public)\b/)
  })

  it('validates finite bounded inputs and checkpoints a single phase deadline', () => {
    expect(code).toContain('not pg_catalog.isfinite(p_deadline)')
    expect(code).toContain('pg_catalog.char_length(p_title) > 500')
    expect(code).toContain('pg_catalog.octet_length(p_title) > 2000')
    expect(code).toContain("pg_catalog.clock_timestamp() + interval '8 seconds'")
    expect(code).toContain("pg_catalog.clock_timestamp() + interval '20 seconds'")
    expect(code.match(/pg_catalog\.clock_timestamp\(\) >= v_phase_deadline/g)).toHaveLength(5)
    expect(code).toContain('pg_catalog.octet_length(v_result::text) > 16384')
  })

  it('takes the managed settings lock before the operation/Class/revision fences', () => {
    const settings = code.indexOf('from public.managed_storage_settings settings')
    const operation = code.indexOf('public.classroom_purge_try_lock(p_classroom_id)')
    const classroom = code.indexOf('from public.classrooms classroom')
    const revision = code.indexOf('from public.classroom_archive_revisions revision')
    expect(settings).toBeGreaterThan(-1)
    expect(operation).toBeGreaterThan(settings)
    expect(classroom).toBeGreaterThan(operation)
    expect(revision).toBeGreaterThan(classroom)
    expect(code).toContain('where settings.singleton for share nowait')
    expect(code).toContain('where classroom.id = p_classroom_id for update nowait')
    expect(code).toContain('where revision.classroom_id = p_classroom_id for update nowait')
    expect(code).not.toMatch(/\b(?:set_config|pg_advisory_xact_lock|nextval)\s*\(/)
  })

  it('authorizes only the current active owner, independently of role and plan', () => {
    expect(code).toContain('v_classroom_before.teacher_id is distinct from p_actor_id')
    expect(code).toContain('v_classroom_before.archived_at is not null')
    expect(code).toContain("public.is_classroom_archive_maintenance_mode('restore')")
    expect(code).toContain("public.is_classroom_archive_maintenance_mode('compaction')")
    expect(code).toContain("pg_catalog.current_setting('pika.identity_mapping', true)")
    expect(code.match(/perform public\.guard_classroom_purge_lifecycle\(p_classroom_id\)/g)).toHaveLength(2)
    expect(code).not.toMatch(/\.role\b|classroom_enrollments|user_plans|entitlements|auth\.uid/)
  })

  it('uses indexed maximum ordering over all Tests without imposing uniqueness', () => {
    expect(code).toMatch(/create index idx_tests_classroom_position_owner_create\s+on public\.tests \(classroom_id, position desc, id desc\)/)
    const allocator = code.slice(code.indexOf('select test.position'), code.indexOf('if not found then v_position'))
    expect(allocator).toContain('where test.classroom_id = p_classroom_id')
    expect(allocator).toContain('order by test.position desc, test.id desc limit 1')
    expect(allocator).not.toMatch(/blueprint_archived_at|status|\bmax\(/)
    expect(code).toContain('v_last_position = 2147483647')
    expect(code).toContain('v_position := v_last_position + 1')
    expect(code).not.toMatch(/create unique index|on conflict|\bdelete from\b/)
  })

  it('generates identities and inserts exactly one Test and canonical empty draft together', () => {
    expect(code.match(/:= pg_catalog\.gen_random_uuid\(\)/g)).toHaveLength(3)
    expect(code.match(/insert into public\.tests\(/g)).toHaveLength(1)
    expect(code.match(/insert into public\.assessment_drafts\(/g)).toHaveLength(1)
    expect(code).toContain("'question_identity_version', 1, 'questions', '[]'::jsonb, 'source_format', 'markdown'")
    expect(code).toContain("values(v_draft_id,'test',v_test_id,p_classroom_id,v_content,1,p_actor_id,p_actor_id)")
    expect(code.match(/get diagnostics v_count = row_count/g)).toHaveLength(2)
    expect(code).not.toMatch(/save_test_draft_atomic|create_guided_test|\bupdate public\.tests\b|\bdelete\b/)
  })

  it('retains inherited defaults and verifies complete rows after both inserts', () => {
    expect(code).toContain("'points_possible',100,'include_in_final',true")
    expect(code).toContain("'gradebook_category_id',v_category_id,'gradebook_weight',v_category_weight")
    expect(code).toContain("'gradebook_maximum_override',null,'gradebook_score_scale',1")
    expect(code).toContain('order by category.is_default desc, category.position, category.id')
    expect(code).toContain('coalesce(v_category_before.default_assessment_weight, 10)')
    expect(code).toContain('pg_catalog.to_jsonb(v_test) is distinct from v_test_expected')
    expect(code).toContain('pg_catalog.to_jsonb(v_draft) is distinct from v_draft_expected')
    expect(code.indexOf('select test.* into v_test')).toBeGreaterThan(code.indexOf('insert into public.assessment_drafts'))
    expect(code).toContain("where draft.assessment_type='test' and draft.assessment_id=v_test_id limit 2")
  })

  it('verifies the precise Class/archive effects and unchanged settings/category witnesses', () => {
    expect(code).toContain('v_classroom_before.blueprint_source_revision + 2')
    expect(code).toContain('v_archive_before.revision + 4')
    for (const [after, before] of [
      ['v_classroom_after', 'v_classroom_expected'], ['v_archive_after', 'v_archive_expected'],
      ['v_settings_after', 'v_settings_before'], ['v_category_after', 'v_category_before'],
    ]) expect(code).toContain(`pg_catalog.to_jsonb(${after}) is distinct from pg_catalog.to_jsonb(${before})`)
    expect(code).toContain('v_classroom_before.blueprint_source_revision > 9223372036854775805')
    expect(code).toContain('v_archive_before.revision > 9223372036854775803')
  })

  it('rejects fresh-Test child work and managed-object/reference side effects', () => {
    for (const table of [
      'test_questions', 'test_attempts', 'test_responses', 'test_student_availability',
      'test_focus_events', 'test_ai_grading_runs', 'test_ai_grading_run_items',
    ]) expect(code).toContain(`from public.${table} where test_id=v_test_id`)
    expect(code).toContain('from public.gradebook_score_overrides where classroom_id=p_classroom_id')
    expect(code).toContain('from public.managed_storage_json_references reference')
    expect(code).toContain('from public.managed_storage_objects where classroom_id=p_classroom_id and resource_id=v_test_id')
    expect(code).not.toMatch(/\b(?:insert into|update|delete from) storage\./)
  })

  it('returns the private versioned pair witness and maps only closed contention/fence states', () => {
    expect(code).toContain("'version',1,'actor_id',p_actor_id")
    expect(code).toContain("'classroom_id',p_classroom_id,'test_id',v_test_id,'test',v_test_expected,'draft',v_draft_expected")
    expect(code).toContain('when lock_not_available or deadlock_detected or serialization_failure then')
    expect(code).toContain("if sqlerrm in ('classroom_purge_active','attendance_decommission_active','attendance_decommission_irreversible')")
    expect(code).not.toMatch(/when others|when insufficient_privilege|\b42501\b/)
  })
})
