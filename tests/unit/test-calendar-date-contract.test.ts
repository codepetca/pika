import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { TEST_CALENDAR_DATE_REVIEWED_MIGRATION, validateTestCalendarDateReviewedMigration } from '../../scripts/test-calendar-date-reviewed-migration'
import { describe, expect, it } from 'vitest'
import { testCalendarDatePatchSchema } from '@/lib/validations/test-calendar-date'
import { contextualTestOwnerMetadataSchema } from '@/lib/validations/contextual-test-owner-workflow'

const migration = readFileSync('supabase/migrations/263_test_calendar_date.sql', 'utf8')
describe('Test calendar metadata storage contract', () => {
  it('seals the current additive migration and refuses unknown names, altered bytes and self-hashed changes', () => {
    const evidence = { ...TEST_CALENDAR_DATE_REVIEWED_MIGRATION, sql: migration }
    expect(() => validateTestCalendarDateReviewedMigration(evidence)).not.toThrow()
    expect(() => validateTestCalendarDateReviewedMigration({ ...evidence, name: '263_unknown.sql' })).toThrow()
    expect(() => validateTestCalendarDateReviewedMigration({ ...evidence, sql: migration + '\n' })).toThrow()
    const sql = migration + '\n'
    expect(() => validateTestCalendarDateReviewedMigration({ ...evidence, sql, sha256: createHash('sha256').update(sql).digest('hex') })).toThrow()
  })
  it('accepts leap days and clearing, while rejecting invalid dates and mixed metadata', () => {
    expect(testCalendarDatePatchSchema.parse({ test_date: '2028-02-29' })).toEqual({ test_date: '2028-02-29' })
    expect(testCalendarDatePatchSchema.parse({ test_date: null })).toEqual({ test_date: null })
    for (const test_date of ['2026-02-29', '0000-01-01', '2026-10-20T10:00:00Z', 123]) {
      expect(testCalendarDatePatchSchema.safeParse({ test_date }).success).toBe(false)
      expect(contextualTestOwnerMetadataSchema.safeParse({ test_date }).success).toBe(false)
    }
    expect(contextualTestOwnerMetadataSchema.safeParse({ test_date: null, title: 'Changed' }).success).toBe(false)
  })
  it('retains the latest owner operations instead of replacing them with an earlier slice', () => {
    for (const operation of ['delete', 'unpublish', 'unsubmit', 'return', 'manual-save']) expect(migration).toContain(`p_operation = '${operation}'`)
    expect(migration).toContain('alter table public.tests add column test_date date;')
    expect(migration).toContain('or v_test.test_date is not null')
    expect(migration).toContain("'status','test_date','title','updated_at'")
    expect(migration).toContain("'test_date',v_test.test_date")
  })
})
