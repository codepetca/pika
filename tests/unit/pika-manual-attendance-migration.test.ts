import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/147_pika_manual_attendance.sql'),
  'utf8',
)

describe('Pika manual attendance migration', () => {
  it('stores classroom settings and per-date teacher overrides', () => {
    expect(migration).toContain('create table public.manual_attendance_settings')
    expect(migration).toContain('create table public.manual_attendance_marks')
    expect(migration).toContain('primary key (classroom_id, class_date, student_id)')
    expect(migration).toContain("source_mode text not null default 'manual'")
    expect(migration).toContain("check (source_mode in ('log', 'manual'))")
    expect(migration).toContain("check (status in ('present', 'late', 'absent'))")
  })

  it('binds marks to the classroom roster and keeps authenticated clients out', () => {
    expect(migration).toContain('foreign key (classroom_id, student_id)')
    expect(migration).toContain('references public.classroom_enrollments (classroom_id, student_id)')
    expect(migration).toContain('alter table public.manual_attendance_settings enable row level security')
    expect(migration).toContain('alter table public.manual_attendance_marks enable row level security')
    expect(migration).toContain('from public, anon, authenticated')
  })

  it('changes the QR close-before-end default to zero minutes', () => {
    expect(migration).toContain(
      'alter column entry_closes_minutes_before_end set default 0',
    )
  })
})
