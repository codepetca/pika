import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const path = resolve(process.cwd(), 'supabase/migrations/251_contextual_test_pristine_owner_discard.sql')
const source = existsSync(path) ? readFileSync(path, 'utf8') : ''
const code = source.replace(/--[^\n]*/g, '')

describe('contextual pristine Test discard additive SQL boundary', () => {
  it('grants only one bounded service entrypoint, without replacing the legacy function', () => {
    expect(code.trim()).toMatch(/^begin;/)
    expect(code.trim()).toMatch(/commit;$/)
    expect(code).toContain('create function public.discard_pristine_test_draft_for_owner_v1(')
    expect(code).toMatch(/security definer\s+set search_path = ''\s+set lock_timeout = '1s'/)
    expect(code).toMatch(/revoke all on function public\.discard_pristine_test_draft_for_owner_v1\(uuid,uuid,integer,timestamptz,timestamptz\)\s+from public, anon, authenticated/)
    expect(code).toMatch(/grant execute on function public\.discard_pristine_test_draft_for_owner_v1\(uuid,uuid,integer,timestamptz,timestamptz\)\s+to service_role/)
    expect(code).not.toMatch(/(?:create or replace|drop function).*discard_pristine_test_draft_atomic/)
  })

  it('checks finite caller timestamps and phase deadlines before any lock or delete', () => {
    expect(code).toContain('p_expected_draft_version < 1')
    expect(code).toContain('not pg_catalog.isfinite(p_expected_test_updated_at)')
    expect(code).toContain('not pg_catalog.isfinite(p_deadline)')
    expect(code).toContain("pg_catalog.clock_timestamp() + interval '8 seconds'")
    expect(code).toContain("pg_catalog.clock_timestamp() + interval '20 seconds'")
    expect(code.indexOf('pg_catalog.clock_timestamp() >= v_phase_deadline')).toBeLessThan(code.indexOf('from public.managed_storage_settings'))
    expect(code).not.toMatch(/\b(?:set_config|nextval|pg_advisory_xact_lock)\s*\(/)
  })

  it('takes settings and bounded operation/membership locks before parent and resource locks', () => {
    const ordered = [
      'from public.managed_storage_settings settings',
      'public.classroom_purge_try_lock(v_classroom_id)',
      'private.try_lock_classroom_membership_change(v_classroom_id)',
      'from public.classrooms classroom',
      'from public.classroom_archive_revisions revision',
      'from public.tests test',
      'from public.assessment_drafts draft',
    ]
    const positions = ordered.map(part => code.indexOf(part, part === 'from public.tests test' ? code.indexOf('from public.classroom_archive_revisions revision') : 0))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(code).toContain('where settings.singleton for share nowait')
    expect(code).toContain('where classroom.id = v_classroom_id for update nowait')
    expect(code).toContain('where revision.classroom_id = v_classroom_id for update nowait')
    expect(code).toContain('for key share nowait')
    expect(code).toContain('pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(p_test_id::text, 0))')
  })

  it('checks exact global Test-associated managed resources through a dedicated partial index', () => {
    expect(code).toMatch(/create index idx_managed_storage_test_resource_owner_discard\s+on public\.managed_storage_objects \(resource_id\) where resource_type = 'test'/)
    expect(code).toContain("where resource_type = 'test' and resource_id = p_test_id")
    expect(code).not.toMatch(/managed_storage_objects[^;]*status\s*(?:=|in)/)
  })

  it('pins Test/Class binding and authorizes only the current active owner', () => {
    expect(code).toContain('v_classroom_before.teacher_id is distinct from p_actor_id')
    expect(code).toContain('v_classroom_before.archived_at is not null')
    expect(code).toContain('test.id = p_test_id and test.classroom_id = v_classroom_id')
    expect(code).toContain('v_test_before.blueprint_archived_at is not null')
    expect(code).toContain("public.is_classroom_archive_maintenance_mode('restore')")
    expect(code).toContain("public.is_classroom_archive_maintenance_mode('compaction')")
    expect(code).toContain("pg_catalog.current_setting('pika.identity_mapping', true)")
    expect(code).not.toMatch(/\.role\b|classroom_enrollments|user_plans|entitlements|auth\.uid/)
  })

  it('does not delegate cleanup when additional dependent work could cascade away', () => {
    for (const table of ['test_questions', 'test_attempts', 'test_responses', 'test_student_availability',
      'test_focus_events', 'test_ai_grading_runs', 'test_ai_grading_run_items', 'gradebook_score_overrides',
      'managed_storage_json_references', 'managed_storage_objects', 'classroom_guided_draft_provenance']) {
      expect(code).toContain(`from public.${table}`)
    }
    expect(code).toContain('if not v_has_dependent_work then')
    expect(code).not.toMatch(/\b(?:insert into|update|delete from) storage\./)
  })

  it('delegates the existing dual CAS and pristine predicate only once, with no generic deletion', () => {
    // The ACL inquiry names the dependency in a literal, not another invocation.
    const executable = code.replace(/'(?:''|[^'])*'/g, '')
    expect(executable.match(/public\.discard_pristine_test_draft_atomic\(/g)).toHaveLength(1)
    expect(code).toContain('p_test_id, p_actor_id, p_expected_draft_version, p_expected_test_updated_at')
    expect(code).not.toMatch(/\bdelete from public\./)
    expect(code).toContain('v_draft_before.classroom_id is distinct from v_classroom_id')
    expect(code).toContain("'reason','draft_changed'")
  })

  it('checks unchanged complete no-op rows and absence of both deleted rows after triggers', () => {
    expect(code).toContain('pg_catalog.to_jsonb(v_test_after) is distinct from pg_catalog.to_jsonb(v_test_before)')
    expect(code).toContain('pg_catalog.to_jsonb(v_draft_after) is distinct from pg_catalog.to_jsonb(v_draft_before)')
    expect(code).toContain("v_legacy_result is distinct from '{\"discarded\":true}'::jsonb")
    expect(code).toContain('test.id = p_test_id')
    expect(code).toContain("draft.assessment_type = 'test' and draft.assessment_id = p_test_id")
    expect(code).toContain('draft.id = v_draft_before.id')
    expect(code).toContain('v_test_before.updated_at is distinct from p_expected_test_updated_at')
    expect(code).toContain('v_draft_before.version is distinct from p_expected_draft_version')
  })

  it('verifies full parent/revision/settings witnesses and repeats lifecycle fences', () => {
    for (const [after, expected] of [['v_classroom_after', 'v_classroom_expected'], ['v_archive_after', 'v_archive_expected'],
      ['v_settings_after', 'v_settings_before']]) {
      expect(code).toContain(`pg_catalog.to_jsonb(${after}) is distinct from pg_catalog.to_jsonb(${expected})`)
    }
    expect(code.match(/perform public\.guard_classroom_purge_lifecycle\(v_classroom_id\)/g)).toHaveLength(2)
  })

  it('returns a strictly bound private witness and keeps raw privilege/unknown fence errors closed', () => {
    expect(code).toContain("'version',1,'actor_id',p_actor_id,'test_id',p_test_id")
    expect(code).toContain("'classroom',pg_catalog.jsonb_build_object('id',v_classroom_id,'teacher_id',p_actor_id,'archived_at',null)")
    expect(code).toContain("'test',pg_catalog.to_jsonb(v_test_before),'draft',v_draft_json")
    expect(code).toContain('pg_catalog.octet_length(v_result::text) > 4194304')
    expect(code).toContain('when lock_not_available or deadlock_detected or serialization_failure then')
    expect(code).not.toMatch(/when others|when insufficient_privilege|when sqlstate '42501'/)
  })

  it('does not let a postgres definer silently bypass withdrawal of the inherited service capability', () => {
    expect(code).toContain("pg_catalog.has_function_privilege('service_role',")
    expect(code).toContain("'public.discard_pristine_test_draft_atomic(uuid,uuid,integer,timestamptz)', 'EXECUTE')")
    expect(code).toContain("errcode = '42501', message = 'test_discard_capability_unavailable'")
    expect(code).not.toMatch(/grant[^;]*discard_pristine_test_draft_atomic/)
  })
})
