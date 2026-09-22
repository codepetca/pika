import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/201_student_grades_visibility.sql'),
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
    expect(migration).toContain('normalize_classroom_archive_restore_row')
    expect(migration).toContain("p_table_name = 'assignment_docs'")
    expect(migration).toContain("'questions_locked_at'")
    expect(migration).toContain("'response_revision'")
    expect(migration).toContain("'question_grading_snapshot'")
    expect(migration).toContain("p_table_name = 'test_ai_grading_runs'")
  })
})
