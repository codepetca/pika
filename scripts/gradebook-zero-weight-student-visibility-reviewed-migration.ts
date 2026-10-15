/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const GRADEBOOK_ZERO_WEIGHT_STUDENT_VISIBILITY_REVIEWED_MIGRATION = Object.freeze({
  name: '266_gradebook_zero_weight_student_visibility.sql',
  sha256: 'a8f9e0a39fcd8bd3bbbfdc4f81806ed7cd33acdc1ddf0fde09ddee820175748c',
})
export function validateGradebookZeroWeightStudentVisibilityReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, GRADEBOOK_ZERO_WEIGHT_STUDENT_VISIBILITY_REVIEWED_MIGRATION.name)
  const seal = GRADEBOOK_ZERO_WEIGHT_STUDENT_VISIBILITY_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
