import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLASSROOM_ARCHIVE_V2_RESOURCES } from '@/lib/contracts/classroom-archive-resources'
import { CLASSROOM_RELATIONAL_RESOURCES } from '@/lib/contracts/classroom-data'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/147_pika_manual_attendance.sql'),
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
    expect(migration).toContain('student_id = any(p_student_ids)')
    expect(migration).toContain("using errcode = '23503'")
    expect(migration).toContain('from public, anon, authenticated')
    expect(migration).toContain('to service_role')
  })

  it('changes the QR close-before-end default to zero minutes', () => {
    expect(migration).toContain(
      'alter column entry_closes_minutes_before_end set default 0',
    )
  })
})
