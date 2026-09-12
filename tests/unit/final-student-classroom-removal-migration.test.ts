import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/165_final_student_classroom_removal.sql', 'utf8')
describe('final classroom removal forward migration', () => {
  it('blocks roster writes by both retained and current account identity under the classroom lock', () => {
    expect(sql).toContain('private.guard_final_student_roster_write()')
    expect(sql).toContain('private.try_lock_classroom_membership_change(new.classroom_id)')
    expect(sql).toContain("tg_op = 'UPDATE' and old.removed_at is not null")
    expect(sql).toContain('lower(btrim(removed.email)) = lower(btrim(new.email))')
    expect(sql).toContain('lower(btrim(student.email)) = lower(btrim(new.email))')
    expect(sql).toContain('before insert or update on public.classroom_roster')
  })

  it('retires restoration without an old-server rolling-deployment failure for ordinary additions', () => {
    const retired = sql.slice(sql.indexOf('create or replace function public.restore_removed_classroom_students('))
    expect(retired).toContain("'restored_count', 0")
    expect(retired).toContain("message = 'student_class_data_pending_purge'")
    expect(retired).toContain('teacher_id = p_teacher_id and archived_at is null')
    expect(retired).not.toMatch(/insert into public.classroom_enrollments|set removed_at = null/)
    expect(retired).toContain('to service_role')
  })

  it('removes the restore-setting bypass and protects enrollment identity updates', () => {
    expect(sql).not.toContain("current_setting('pika.classroom_membership_restore'")
    expect(sql).toContain('before insert or update of classroom_id, student_id on public.classroom_enrollments')
    expect(sql).not.toMatch(/delete from|truncate|cron.schedule/i)
  })

  it('replays legacy invitations only during archive inserts without relaxing enrollment or removed-row edits', () => {
    const enrollment = sql.slice(0, sql.indexOf('create function private.guard_final_student_roster_write()'))
    expect(enrollment).not.toContain('is_classroom_archive_maintenance_mode')
    const archiveAllowance = "tg_op = 'INSERT' and public.is_classroom_archive_maintenance_mode('restore')"
    expect(sql).toContain(archiveAllowance)
    expect(sql.indexOf("tg_op = 'UPDATE' and old.removed_at is not null"))
      .toBeLessThan(sql.indexOf(archiveAllowance))
    expect(sql).not.toContain("is_classroom_archive_maintenance_mode('compaction')")
  })
})
