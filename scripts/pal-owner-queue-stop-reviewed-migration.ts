/** Exact source seal only: no execution, migration or activation authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const PAL_OWNER_QUEUE_STOP_REVIEWED_MIGRATION = Object.freeze({
  name: '287_pal_owner_queue_stop.sql',
  sha256: 'fa2118cf794ae69543e6447d4878ee70eb7228905da88dd0214c7aa3ca7b2fb3',
})

export function validatePalOwnerQueueStopReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = PAL_OWNER_QUEUE_STOP_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
