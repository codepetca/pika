/** Exact reviewed function-only addition; existing table catalogs stay unchanged.
 * Source validation only: this module never grants native execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const TEST_OWNER_WORKFLOW_REVIEWED_MIGRATION = Object.freeze({
  name: '256_contextual_test_owner_workflow.sql',
  sha256: '33fece6f4d2bc64046888d93b88a5349f1028eb9f0851ec4895f81102de2d831',
})

export function validateTestOwnerWorkflowReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_OWNER_WORKFLOW_REVIEWED_MIGRATION.name)
  assert.equal(migration.sha256, TEST_OWNER_WORKFLOW_REVIEWED_MIGRATION.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), TEST_OWNER_WORKFLOW_REVIEWED_MIGRATION.sha256)
}
