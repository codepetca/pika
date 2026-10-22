/** Exact source-only post-date extension. This seal grants no migration,
 * fixture execution, activation, or database application authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const MATERIAL_POST_DATE_REVIEWED_MIGRATION = Object.freeze({
  name: '289_material_post_date.sql',
  sha256: '15937346a18e991f01f6f2be9f4f89d0fdb43d0e12540cd4d8142f25d7f9c86e',
})

export function validateMaterialPostDateReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = MATERIAL_POST_DATE_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
