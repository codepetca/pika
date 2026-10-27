/** Exact source-only post-date extension. This seal grants no migration,
 * fixture execution, activation, or database application authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const INDEPENDENT_CALENDAR_POST_DATES_REVIEWED_MIGRATION = Object.freeze({
  name: '294_independent_calendar_post_dates.sql',
  sha256: '7b4d0853057c7876f4f45bdeaf568e8a62425ff53391fef7ada62bf63ce482d3',
})

export function validateIndependentCalendarPostDatesReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = INDEPENDENT_CALENDAR_POST_DATES_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
