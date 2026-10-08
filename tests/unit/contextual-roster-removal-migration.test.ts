import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/236_contextual_roster_removal_owner_write.sql'), 'utf8')
describe('contextual preserving removal migration source contract', () => {
  it('adds only a service privileged boundary and private validators', () => {
    expect(sql).toContain('create function public.remove_classroom_students_for_owner_v1')
    expect(sql).toContain("security definer set search_path = ''")
    expect(sql).toContain('revoke all on function public.remove_classroom_students_for_owner_v1(uuid,uuid,uuid[]) from public,anon,authenticated')
    expect(sql).toContain('grant execute on function public.remove_classroom_students_for_owner_v1(uuid,uuid,uuid[]) to service_role')
    expect(sql).not.toMatch(/create or replace|student\.role|u\.role|restore_removed|remove_classroom_roster_entries_atomic|delete from public\.(entries|assignment_docs|test_responses|gradebook|users)|insert into public\.classroom_enrollments/i)
  })
  it('locks current ownership, users before matching, exact pairs and lifecycle fences', () => {
    expect(sql).toContain('v_class.teacher_id is distinct from p_actor_id')
    expect(sql).toContain('v_class.archived_at is not null')
    expect(sql).toContain('public.guard_classroom_purge_lifecycle(p_classroom_id)')
    expect(sql).toContain('for share nowait')
    expect(sql).toContain('for update nowait')
    expect(sql.indexOf('for share nowait')).toBeLessThan(sql.indexOf('pg_catalog.lower(pg_catalog.btrim(u.email))'))
    expect(sql).toContain('private.try_lock_classroom_membership_change(p_classroom_id,v_student_id)')
    expect(sql).toContain('public.student_purge_fences where classroom_id=p_classroom_id and student_id=v_student_id')
    expect(sql).toContain("sqlstate '40001' or sqlstate '40P01' or sqlstate '55P03' or sqlstate '55000'")
  })
  it('denies duplicate identities, retains history and verifies whole persisted sets after triggers', () => {
    expect(sql).toContain('This student has multiple roster rows. Resolve the duplicate roster entries before removing them.')
    expect(sql).not.toMatch(/drop index|drop constraint|authorize_removed_academic_cleanup/i)
    expect(sql.indexOf('This student has multiple roster rows.')).toBeLessThan(sql.indexOf('insert into public.classroom_roster_student_bindings'))
    for (const field of ['removed_at', 'removed_student_id', 'removed_enrollment_id', 'removed_enrolled_at', 'retained_manual_attendance_marks', 'retained_attendance_participant_active']) expect(sql).toContain(field)
    for (const field of ['v_expected_roster', 'v_expected_bindings', 'v_expected_enrollments', 'v_expected_mappings']) expect(sql).toContain(field)
    expect(sql).toContain('Roster persisted set changed')
    expect(sql).toContain('private.valid_roster_removal_result_v1')
    expect(sql).toContain('public.classroom_archive_revisions')
  })
})
