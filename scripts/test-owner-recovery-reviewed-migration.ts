/** Inert exact candidate seal, frozen after the implementation delivery.
 * This module never grants native/shared execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const TEST_OWNER_RECOVERY_REVIEWED_MIGRATION = Object.freeze({
  name: '260_contextual_test_owner_recovery.sql',
  sha256: '84cc99afd780ca9f97e1963492793014d68e852ff2586282a30442b6a16559e0',
})
export function validateTestOwnerRecoveryReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.name)
  assert(typeof TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256 === 'string', 'Recovery260 source freeze is pending')
  assert.match(TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.sha256)
}
