import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/244_test_attempt_revision_and_return_guards.sql', 'utf8')
const access = migration.split('create or replace function public.update_test_student_access_atomic(')[1].split('$$;')[0]

describe('selected-student access authoritative transaction', () => {
  it('retains the locked Test and validates current owner/archive/status before changing access', () => {
    const lock = access.indexOf('v_test := private.lock_test_lifecycle(p_test_id)')
    const authority = access.indexOf('teacher_id = p_updated_by and archived_at is null')
    const draft = access.indexOf("v_test.status = 'draft'")
    const mutation = access.indexOf('insert into public.test_student_availability')
    expect(lock).toBeGreaterThan(-1)
    expect(authority).toBeGreaterThan(lock)
    expect(draft).toBeGreaterThan(authority)
    expect(mutation).toBeGreaterThan(draft)
    expect(access).toContain("errcode = '42501'")
  })

  it('deduplicates and share-locks the complete passed enrollment set in deterministic order before any mutation', () => {
    const normalize = access.indexOf('array_agg(distinct id order by id)')
    const enrollment = access.indexOf('from public.classroom_enrollments enrollment')
    const completeness = access.indexOf('cardinality(v_locked_student_ids) <> cardinality(v_student_ids)')
    const mutation = access.indexOf('insert into public.test_student_availability')
    expect(normalize).toBeGreaterThan(-1)
    expect(enrollment).toBeGreaterThan(normalize)
    expect(completeness).toBeGreaterThan(enrollment)
    expect(mutation).toBeGreaterThan(completeness)
    expect(access.slice(enrollment, completeness)).toMatch(/order by enrollment.student_id\s+for share/)
    expect(access).toContain("Selected students changed; reload and retry' using errcode = '40001'")
    expect(access).not.toMatch(/any\(p_student_ids\)|unnest\(p_student_ids\) as selected_students/)
  })
})
