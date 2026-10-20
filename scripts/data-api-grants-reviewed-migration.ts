/** Exact source-only ACL restatement. This seal grants no database execution
 * authority; existing native fixture and rollout gates still apply. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const DATA_API_GRANTS_REVIEWED_MIGRATION = Object.freeze({
  name: '282_explicit_data_api_grants.sql',
  sha256: '9ffd5b8303ff7e118b9ae4ce5ff8d26c0b0dd16c4c586a6a3e96635a70f9f1db',
})

export function validateDataApiGrantsReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, DATA_API_GRANTS_REVIEWED_MIGRATION.name)
  assert.equal(migration.sha256, DATA_API_GRANTS_REVIEWED_MIGRATION.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), DATA_API_GRANTS_REVIEWED_MIGRATION.sha256)
}
