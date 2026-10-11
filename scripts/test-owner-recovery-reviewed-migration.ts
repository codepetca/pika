/** Inert exact candidate seal, frozen after the implementation delivery.
 * This module never grants native/shared execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const TEST_OWNER_RECOVERY_REVIEWED_MIGRATION = Object.freeze({
  name: '260_contextual_test_owner_recovery.sql',
  sha256: 'b60c53cb242dc29356565e8d4718e227cfe6f4e07090814172c44425ab598af9',
})
export function validateTestOwnerRecoveryReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.name)
  assert(typeof TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256 === 'string', 'Recovery260 source freeze is pending')
  assert.match(TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256)
}
