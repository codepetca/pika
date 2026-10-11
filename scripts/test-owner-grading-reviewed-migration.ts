/** Exact function-only candidate source binding. Independent review remains
 * required; this seal never grants native or shared migration execution. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const TEST_OWNER_GRADING_REVIEWED_MIGRATION = Object.freeze({
  name: '258_contextual_test_owner_grading.sql',
  sha256: '698948d58fabdceb9df2869dfa99dc3cd22be6640a198da6de31b17fb9fa3540',
})

export function validateTestOwnerGradingReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_OWNER_GRADING_REVIEWED_MIGRATION.name)
  assert.equal(migration.sha256, TEST_OWNER_GRADING_REVIEWED_MIGRATION.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), TEST_OWNER_GRADING_REVIEWED_MIGRATION.sha256)
}
