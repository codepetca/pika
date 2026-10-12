/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const TEST_OWNER_DELETION_REVIEWED_MIGRATION = Object.freeze({
  name: '262_contextual_test_owner_delete.sql',
  sha256: 'c9f0991d80108baf197068a68e1b1605a3259156ff3c267819701fe3996d5322',
})
export function validateTestOwnerDeletionReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_OWNER_DELETION_REVIEWED_MIGRATION.name)
  const seal = TEST_OWNER_DELETION_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
