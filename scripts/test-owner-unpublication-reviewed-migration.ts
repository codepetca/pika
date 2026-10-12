/** Externally fixed source seal. Pending is inert and grants no execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION = Object.freeze({
  name: '261_contextual_test_owner_unpublish.sql',
  sha256: '8aecd0a3f0b98f44109742b7f7886c87661ae1e2ce525965d880a893deca7c86',
})
export function validateTestOwnerUnpublicationReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.name)
  const seal = TEST_OWNER_UNPUBLICATION_REVIEWED_MIGRATION.sha256
  assert(typeof seal === 'string', 'Owner unpublication261 source freeze is pending')
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
