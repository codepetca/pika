/** Exact source seal only; no migration, provider or activation authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const CONTEXTUAL_REMOVED_MEMBERSHIP_CLEANUP_REVIEWED_MIGRATION = Object.freeze({
  name: '288_contextual_removed_membership_cleanup.sql',
  sha256: 'cdceef8925dba74bfc9fb586915b7b5f75ac2676fc8cfeb3e435c0e8b4636906',
})

export function validateContextualRemovedMembershipCleanupReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = CONTEXTUAL_REMOVED_MEMBERSHIP_CLEANUP_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
