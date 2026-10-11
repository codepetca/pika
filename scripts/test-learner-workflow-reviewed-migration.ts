/** Exact function-only source addition. This is a review binding, never native
 * execution authority or permission to modify the shared database. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const TEST_LEARNER_WORKFLOW_REVIEWED_MIGRATION = Object.freeze({
  name: '257_contextual_test_learner_workflow.sql',
  sha256: 'd4f12d17b79e4800e5bdd6ea7db2c0fee7cf51d19a5dfde93084c243b22c1e2a',
})

export function validateTestLearnerWorkflowReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_LEARNER_WORKFLOW_REVIEWED_MIGRATION.name)
  assert.equal(migration.sha256, TEST_LEARNER_WORKFLOW_REVIEWED_MIGRATION.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), TEST_LEARNER_WORKFLOW_REVIEWED_MIGRATION.sha256)
}
