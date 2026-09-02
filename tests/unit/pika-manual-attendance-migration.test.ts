import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASSROOM_ARCHIVE_V2_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/150_pika_manual_attendance.sql'),
  'utf8',
)

describe('Pika manual attendance migration', () => {
  it('stores settings and marks on archive-owned classroom resources', () => {
    expect(migration).toContain('alter table public.classrooms')
    expect(migration).toContain("manual_attendance_source_mode text not null default 'manual'")
    expect(migration).toContain('manual_attendance_revision bigint not null default 1')
    expect(migration).toContain('alter table public.classroom_enrollments')
    expect(migration).toContain("manual_attendance_marks jsonb not null default '{}'::jsonb")
    expect(migration).not.toContain('create table public.manual_attendance_')
    for (const table of ['classrooms', 'classroom_enrollments']) {
      expect(CLASSROOM_ARCHIVE_V2_RESOURCES.map((resource) => resource.table)).toContain(table)
      expect(CLASSROOM_RELATIONAL_RESOURCES.map((resource) => resource.table)).toContain(table)
    }
  })

  it('uses service-role RPCs with revision and roster-race protection', () => {
    expect(migration).toContain('set_pika_manual_attendance_settings')
    expect(migration).toContain('manual_attendance_revision = p_expected_revision')
    expect(migration).toContain("using errcode = '40001'")
    expect(migration).toContain('set_pika_manual_attendance_marks')
    expect(migration).toContain('from public.class_days')
    expect(migration).toContain('and date = p_class_date')
    expect(migration).toContain('and is_class_day')
    expect(migration).toContain('Attendance date is not an active class day')
    expect(migration).toContain('student_id = any(p_student_ids)')
    expect(migration.indexOf('for update;')).toBeLessThan(
      migration.indexOf('update public.classroom_enrollments'),
    )
    expect(migration).toContain("using errcode = '23503'")
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })

  it('defaults new fields when restoring archives created before migration 150', () => {
    expect(migration).toContain('normalize_classroom_archive_restore_row')
    expect(migration).toContain('rename to normalize_classroom_archive_restore_row_v147')
    expect(migration).toContain('public.normalize_classroom_archive_restore_row_v147(')
    for (const field of [
      'manual_attendance_source_mode',
      'manual_attendance_session_starts_local',
      'manual_attendance_session_ends_local',
      'manual_attendance_revision',
      'manual_attendance_marks',
    ]) {
      expect(migration).toContain(`not (p_row ? '${field}')`)
    }
    expect(migration).toContain("p_table_name = 'classroom_enrollments'")
  })

  it('changes the QR close-before-end default to zero minutes', () => {
    expect(migration).toContain(
      'alter column entry_closes_minutes_before_end set default 0',
    )
  })

  it('fails safely on legacy early-open values before enforcing the two-hour maximum', () => {
    expect(migration).toContain('where entry_opens_minutes_before > 120')
    expect(migration).toContain(
      'Existing QR early-open lead exceeds the 120-minute maximum',
    )
    expect(migration).not.toContain('set entry_opens_minutes_before = 120')
    expect(migration).toContain('check (entry_opens_minutes_before between 0 and 120)')
  })

  it('enforces the shared 12-hour maximum in stored attendance policies', () => {
    expect(migration).toContain('attendance_window_policy_duration_check')
    expect(migration).toContain('classrooms_manual_attendance_duration_check')
    expect(migration).toContain('closes_local - opens_local')
    expect(migration).toContain("close_day_offset * interval '1 day'")
    expect(migration).not.toContain('extract(hour from')
    expect(migration).toContain("interval '12 hours'")
  })
})
