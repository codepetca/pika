/** Exact source-only post-date extension. This seal grants no migration,
 * fixture execution, activation, or database application authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const ANNOUNCEMENT_POST_DATE_REVIEWED_MIGRATION = Object.freeze({
  name: '290_announcement_post_date.sql',
  sha256: 'bea690465695fab90539731d06fd0fb47b61cb3103ac398e21495865073db643',
})

export function validateAnnouncementPostDateReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = ANNOUNCEMENT_POST_DATE_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
