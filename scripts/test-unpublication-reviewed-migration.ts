/** Source-only profile extension: this exact reviewed migration adds two RPCs
 * and leaves the existing snapshot table catalogs unchanged. No runtime I/O. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const TEST_UNPUBLICATION_REVIEWED_MIGRATION = Object.freeze({
  name: '255_return_test_to_draft_atomic.sql',
  sha256: '363bb86f7c45c0580613fc236b30dcd38471481c1115a826ec02a4fded969ccd',
})

export function validateTestUnpublicationReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_UNPUBLICATION_REVIEWED_MIGRATION.name)
  assert.equal(migration.sha256, TEST_UNPUBLICATION_REVIEWED_MIGRATION.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), TEST_UNPUBLICATION_REVIEWED_MIGRATION.sha256)
}
