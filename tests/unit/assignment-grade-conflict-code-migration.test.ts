import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const original = readFileSync(resolve(process.cwd(), 'supabase/migrations/087_atomic_assignment_feedback_returns.sql'), 'utf8')
const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/223_stop_assignment_grade_conflict_retries.sql'), 'utf8')

function manualGradeFunction(sql: string): string {
  const start = sql.indexOf('create or replace function public.save_assignment_grades_atomic(')
  return sql.slice(start, sql.indexOf('\n$$;', start) + 4)
}

describe('manual Assignment grade conflict error code', () => {
  it('changes only the stale-revision error code while preserving the complete grading boundary', () => {
    expect(manualGradeFunction(migration)).toBe(
      manualGradeFunction(original).replace("errcode = '40001'", "errcode = 'PT409'"),
    )
    expect(migration.match(/create or replace function/g)).toHaveLength(1)
    expect(migration).not.toMatch(/\bdrop\b|\bgrant\b|\brevoke\b/i)
  })
})
