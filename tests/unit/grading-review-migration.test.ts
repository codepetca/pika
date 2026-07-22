import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/104_teacher_grading_reviews.sql'),
  'utf8',
).toLowerCase()
const assignmentHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-atomic-assignment-feedback-returns.sh'),
  'utf8',
).toLowerCase()
const testHarness = readFileSync(
  resolve(process.cwd(), 'scripts/check-atomic-test-grading.sh'),
  'utf8',
).toLowerCase()

describe('teacher grading review migration', () => {
  it('adds one strict, bounded, identity-free review snapshot to each grading record', () => {
    expect(migration.match(/add column if not exists ai_grading_review jsonb/g)).toHaveLength(2)
    expect(migration).toContain('grading-review-v1')
    expect(migration).toContain('assignment_docs_ai_grading_review_contract')
    expect(migration).toContain('test_responses_ai_grading_review_contract')
    expect(migration).toContain('octet_length(p_review::text) > 8192')
    expect(migration).toContain("p_review - array[")
    expect(migration).not.toContain("'studentid'")
    expect(migration).not.toContain("'assignmentid'")
    expect(migration).not.toContain("'testid'")
    expect(migration).not.toContain("'suggestedfeedback'")
    expect(migration).not.toContain("'finalfeedback'")
  })

  it('captures assignment suggestions and finalizes them when teachers return work', () => {
    expect(migration).toContain('create trigger sync_assignment_ai_grading_review')
    expect(migration).toContain("jsonb_build_object('criterionid', 'completion'")
    expect(migration).toContain("jsonb_build_object('criterionid', 'thinking'")
    expect(migration).toContain("jsonb_build_object('criterionid', 'workflow'")
    expect(migration).toContain("new.returned_at is distinct from old.returned_at")
    expect(migration).toContain("jsonb_set(v_review, '{reviewstatus}', '\"reviewed\"'::jsonb)")
  })

  it('captures test suggestions without a second revision and finalizes on attempt return', () => {
    expect(migration).toContain('create trigger sync_test_ai_grading_review')
    expect(migration).toContain('create trigger mark_test_grading_reviews_returned')
    expect(migration).toContain("to_jsonb(new) - array['ai_grading_provenance', 'ai_grading_review']")
    expect(migration).toContain("jsonb_build_object('criterionid', 'response'")
  })

  it('keeps database-backed acceptance, correction, dismissal, and privacy checks in CI', () => {
    expect(assignmentHarness).toContain("v_review->>'reviewstatus'")
    expect(assignmentHarness).toContain('assignment grading review retained forbidden identity fields')
    expect(assignmentHarness).toContain('assignment grading review did not preserve the ai suggestion')
    expect(testHarness).toContain("v_review->>'reviewstatus'")
    expect(testHarness).toContain('test grading review changed the response revision')
    expect(testHarness).toContain('test grading review dismissal was not captured')
  })
})
