/** Exact additive source profile extension. Prior migration seals and canonical
 * baseline policy remain unchanged; this grants no database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const GRADEBOOK_WORKFLOW_REVIEWED_MIGRATION = Object.freeze({
  name: '270_contextual_gradebook_workflow.sql',
  sha256: '963af7b09f90ab49492a3c65f95eebe922984a60a5a9b68de0d1804c36dc5803',
})

export function validateGradebookWorkflowReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, GRADEBOOK_WORKFLOW_REVIEWED_MIGRATION.name)
  const seal = GRADEBOOK_WORKFLOW_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
