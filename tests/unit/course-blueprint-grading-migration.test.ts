import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function readMigration() {
  return readFileSync(
    resolve(process.cwd(), 'supabase/migrations/080_course_blueprint_grading_configuration.sql'),
    'utf8'
  )
}

describe('course blueprint grading configuration migration', () => {
  it('stores reusable assignment and assessment grading fields with safe defaults', () => {
    const migration = readMigration()

    expect(migration).toContain('public.course_blueprint_assignments')
    expect(migration).toContain('gradebook_weight integer not null default 10')
    expect(migration).toContain('public.course_blueprint_assessments')
    expect(migration).toContain('points_possible integer')
    expect(migration).toContain('include_in_final boolean not null default true')
    expect(migration).toContain('gradebook_weight >= 1 and gradebook_weight <= 999')
  })
})
