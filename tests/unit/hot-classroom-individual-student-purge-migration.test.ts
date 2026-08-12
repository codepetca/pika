import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(
  process.cwd(),
  'supabase/migrations/123_hot_classroom_individual_student_purge.sql',
), 'utf8').toLowerCase()

describe('migration 123 individual-student purge contract', () => {
  it('starts disabled and scopes canary rollout to an exact teacher, classroom, and student', () => {
    expect(sql).toContain("rollout_mode text not null default 'disabled'")
    expect(sql).toContain('canary_teacher_id')
    expect(sql).toContain('canary_classroom_id')
    expect(sql).toContain('canary_student_id')
  })

  it('uses durable exact relational and managed-object ledgers', () => {
    expect(sql).toContain('create table public.classroom_roster_student_bindings')
    expect(sql).not.toContain('alter table public.classroom_roster\n  add column student_id')
    expect(sql).toContain('create table public.student_purge_resources')
    expect(sql).toContain('create table public.student_purge_objects')
    expect(sql).toContain('managed_storage_object_id uuid')
    expect(sql).toContain('references public.managed_storage_objects (id) on delete set null')
    expect(sql).toContain('student_purge_storage_object_still_present')
    expect(sql).toContain('student_purge_membership_drift_')
    expect(sql).toContain('student_purge_storage_owner_drift')
    expect(sql).toContain('student_purge_path_reserved')
    expect(sql).toContain('storage_student_purge_path_reservation')
  })

  it('uses fences, leases, retry backoff, and mutually excludes whole-classroom purge', () => {
    expect(sql).toContain('create table public.student_purge_fences')
    expect(sql).toContain('lease_token uuid')
    expect(sql).toContain('lease_expires_at timestamptz')
    expect(sql).toContain('next_attempt_at = clock_timestamp() + make_interval')
    expect(sql).toContain('hot_purge_student_fence_conflict')
    expect(sql).toContain('cold_purge_student_fence_conflict')
    expect(sql).toContain('else array[to_jsonb(old), to_jsonb(new)] end')
  })

  it('closes the finalization writer bypass before returning to the caller', () => {
    expect(sql).toMatch(
      /delete from public\.student_purge_fences[\s\S]*perform set_config\('pika\.student_purge_finalize', 'off', true\);[\s\S]*return jsonb_build_object/,
    )
  })

  it('preserves the user and fails closed for unimplemented provider erasure', () => {
    expect(sql).not.toMatch(/delete\s+from\s+public\.users/)
    expect(sql).not.toMatch(/delete\s+from\s+public\.student_profiles/)
    expect(sql).toContain('student_purge_external_erasure_required')
    expect(sql).toContain('student_purge_gradex_erasure_required')
    expect(sql).toContain('student_purge_retired_assessment_unsupported')
    expect(sql).toContain('student_purge_storage_subject_ownership_incomplete')
  })

  it('retains replay-safe target binding and removes grading selection identity', () => {
    expect(sql).toContain('student_binding_sha256')
    expect(sql).toContain("p_operation_id::text || ':' || p_student_id::text")
    expect(sql).toContain("'student-purge:' || p_operation_id::text || ':' || run.id::text")
    expect(sql).toContain('selection_hash = encode')
  })

  it('removes immutable class archive copies but not other classrooms or blueprints', () => {
    expect(sql).toContain('delete from public.classroom_archives where classroom_id = v_operation.classroom_id')
    expect(sql).toContain('delete from public.classroom_gradex_extracts where classroom_id = v_operation.classroom_id')
    expect(sql).toContain('delete from public.classroom_archive_snapshot_actors')
    expect(sql).toContain('delete from public.classroom_archive_snapshot_resources')
    expect(sql).not.toMatch(/delete\s+from\s+public\.course_blueprints/)
    expect(sql).toContain('where card.classroom_id = p_classroom_id and row.student_id = p_student_id')
  })

  it('restricts every mutating RPC to service role and exposes health drift counts', () => {
    expect(sql).toContain('revoke all on function public.begin_student_purge')
    expect(sql).toContain('grant execute on function public.begin_student_purge')
    expect(sql).toContain('get_student_purge_health_snapshot')
    expect(sql).toContain('orphan_fence_count')
    expect(sql).toContain('processing_lease_drift_count')
  })
})
