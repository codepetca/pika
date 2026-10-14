import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { TEST_AI_GRADING_SAVED_WORK_REVIEWED_MIGRATION, validateTestAiGradingSavedWorkReviewedMigration } from '../../scripts/test-ai-grading-saved-work-reviewed-migration'

const sql = readFileSync('supabase/migrations/264_test_ai_grading_saved_work.sql', 'utf8')
const evidence = { ...TEST_AI_GRADING_SAVED_WORK_REVIEWED_MIGRATION, sql }
describe('fixed Test AI grading saved-work migration seal', () => {
  it('accepts the exact reviewed filename, stored hash and raw SQL bytes', () => {
    expect(() => validateTestAiGradingSavedWorkReviewedMigration(evidence)).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('refuses altered %s', defect => {
    const candidate = { ...evidence }
    if (defect === 'name') candidate.name = '264_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = createHash('sha256').update(candidate.sql).digest('hex')
    expect(() => validateTestAiGradingSavedWorkReviewedMigration(candidate)).toThrow()
  })
})
