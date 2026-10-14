/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const TEST_AI_GRADING_SAVED_WORK_REVIEWED_MIGRATION = Object.freeze({
  name: '264_test_ai_grading_saved_work.sql',
  sha256: '577ac80de5bedc33b66078033ac1edf70a59b26e6056cab6dcd06513fabc827d',
})
export function validateTestAiGradingSavedWorkReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_AI_GRADING_SAVED_WORK_REVIEWED_MIGRATION.name)
  const seal = TEST_AI_GRADING_SAVED_WORK_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
