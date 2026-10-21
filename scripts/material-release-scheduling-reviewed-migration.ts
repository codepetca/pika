/** Exact source-only scheduling extension. This seal grants no migration,
 * fixture execution, activation, or database application authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const MATERIAL_RELEASE_SCHEDULING_REVIEWED_MIGRATION = Object.freeze({
  name: '283_material_release_scheduling.sql',
  sha256: '751351ee9e6a3133bf1bef77727286b358b351de9e80b921bfb4e7d59912faab',
})

export function validateMaterialReleaseSchedulingReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = MATERIAL_RELEASE_SCHEDULING_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
