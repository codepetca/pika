/** Exact source extension only; no runtime, application or activation authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const CLASSROOM_HOME_VISIBILITY_REVIEWED_MIGRATION = Object.freeze({
  name: '292_classroom_home_visibility.sql',
  sha256: '3d5d47d92c0750f2a58e71bd0390653a98bbe0d67a49a450d46c2183837f349d',
})
export function validateClassroomHomeVisibilityReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = CLASSROOM_HOME_VISIBILITY_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
