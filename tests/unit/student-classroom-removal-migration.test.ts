import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/164_student_classroom_removal.sql',
  'utf8',
)

describe('migration 164 reversible classroom student removal', () => {
  it('retains membership-owned attendance state and leaves academic data untouched', () => {
    for (const field of [
      'removed_at',
      'removed_student_id',
      'removed_enrollment_id',
      'removed_enrolled_at',
      'retained_manual_attendance_marks',
      'retained_attendance_participant_active',
    ]) {
      expect(migration).toContain(field)
    }
    expect(migration).toContain('update public.classroom_roster')
    expect(migration).toContain('delete from public.classroom_enrollments')
    expect(migration).toMatch(
      /if v_match_count = 0 then[\s\S]*?delete from public\.classroom_roster[\s\S]*?continue;/,
    )
    expect(migration).toContain('update public.attendance_participant_mappings')
    expect(migration).toMatch(
      /select mapping\.active into v_attendance_participant_active[\s\S]*?for update;/,
    )
    expect(migration).toContain(
      'active is distinct from v_roster.retained_attendance_participant_active',
    )
    expect(migration).not.toMatch(/delete from public\.(entries|assignment_docs|test_attempts|pal_event_outbox)/)
  })

  it('preserves Gradebook rows while rejecting new marks without enrollment', () => {
    expect(migration).toContain(
      'drop constraint gradebook_score_overrides_classroom_id_student_id_fkey',
    )
    expect(migration).toContain(
      'drop constraint gradebook_item_scores_classroom_id_student_id_fkey',
    )
    expect(migration).toContain('require_gradebook_enrollment_for_mark_change')
    expect(migration).toContain("message = 'gradebook_student_not_enrolled'")
    expect(migration).toContain("is_classroom_archive_maintenance_mode('restore')")
    expect(migration).not.toMatch(/delete from public\.gradebook_(score_overrides|item_scores)/)
  })

  it('serializes with joining and exposes removal and restore only to service role', () => {
    expect(migration).toContain('private.try_lock_classroom_membership_change')
    expect(migration).toContain('pg_try_advisory_xact_lock')
    expect(migration).toContain("message = 'classroom_operation_busy'")
    expect(migration).toContain("message = 'student_operation_busy'")
    expect(migration).toMatch(
      /try_lock_classroom_membership_change\(p_classroom_id\);[\s\S]*?guard_classroom_purge_lifecycle\(p_classroom_id\);[\s\S]*?from public\.classrooms[\s\S]*?for update;/,
    )
    expect(migration).not.toMatch(
      /perform public\.student_purge_lock\(p_classroom_id, v_(student_id|roster\.removed_student_id)\)/,
    )
    expect(migration).toMatch(/from public\.classrooms[\s\S]*?for update;/)
    expect(migration).toContain('for update of roster')
    expect(migration).toContain('reject_removed_classroom_enrollment_insert')
    expect(migration).toContain('classroom_membership_removed_teacher_restore_required')
    expect(migration).toContain(
      'grant execute on function public.remove_classroom_students_preserving_data(uuid, uuid, uuid[])\n  to service_role;',
    )
    expect(migration).toContain(
      'grant execute on function public.restore_removed_classroom_students(uuid, uuid, text[])\n  to service_role;',
    )
  })

  it('prevents retained rows from falling through to destructive invitation removal', () => {
    expect(migration).toContain('remove_classroom_roster_entries_pre_v164')
    expect(migration).toMatch(
      /removed_students_require_explicit_restore_or_purge[\s\S]*?return private\.remove_classroom_roster_entries_pre_v164/,
    )
  })

  it('keeps removed identity portable across classroom archive restore', () => {
    expect(migration).toContain('normalize_classroom_archive_restore_row_pre_v164')
    expect(migration).toMatch(
      /'retained_attendance_participant_active',[\s\S]*?coalesce\(p_row->'retained_attendance_participant_active', 'null'::jsonb\)/,
    )
    expect(migration).toMatch(
      /classroom_archive_resource_contract[\s\S]*?array_append\(actor_columns, 'removed_student_id'\)/,
    )
    expect(migration).toMatch(
      /classroom_archive_resource_contract_versions[\s\S]*?array_append\(actor_columns, 'removed_student_id'\)/,
    )
    expect(migration).toMatch(
      /if new\.removed_at is not null then[\s\S]*?classroom_roster_student_bindings/,
    )
  })
})
