import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/205_student_grades_visibility.sql'),
  'utf8',
)

describe('student Grades visibility migration', () => {
  it('defaults and backfills the disclosure control to off', () => {
    expect(migration).toContain('"student_grades": false')
    expect(migration).toContain("'{student_grades}'")
    expect(migration).toContain("else 'false'::jsonb")
    expect(migration).toContain("jsonb_typeof(feature_visibility -> 'student_grades') = 'boolean'")
  })

  it('keeps the archive restore adapter current', () => {
    expect(migration).toContain('rename to normalize_classroom_archive_restore_row_pre_v205')
    expect(migration).toContain('p_row := public.normalize_classroom_archive_restore_row_pre_v205(')
    expect(migration).toContain("'{feature_visibility,student_grades}'")
    expect(migration).toContain('grant execute on function public.normalize_classroom_archive_restore_row(uuid, text, jsonb)')
    expect(migration).not.toContain('create or replace function public.normalize_classroom_archive_restore_row')
  })
})
