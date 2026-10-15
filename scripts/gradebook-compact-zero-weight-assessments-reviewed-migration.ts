/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const GRADEBOOK_COMPACT_ZERO_WEIGHT_ASSESSMENTS_REVIEWED_MIGRATION = Object.freeze({
  name: '267_gradebook_compact_zero_weight_assessments.sql',
  sha256: '0b72d5bbd59150f3d4aebf5bbe7b5676df5fddc50dbe96a240f57254dba6c9a2',
})
export function validateGradebookCompactZeroWeightAssessmentsReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, GRADEBOOK_COMPACT_ZERO_WEIGHT_ASSESSMENTS_REVIEWED_MIGRATION.name)
  const seal = GRADEBOOK_COMPACT_ZERO_WEIGHT_ASSESSMENTS_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
