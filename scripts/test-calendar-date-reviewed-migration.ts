/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const TEST_CALENDAR_DATE_REVIEWED_MIGRATION = Object.freeze({
  name: '263_test_calendar_date.sql',
  sha256: 'f01e1284139151436a034d929c6fa44b1aecf976a62d661cc760d7f7eff1bbe5',
})
export function validateTestCalendarDateReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_CALENDAR_DATE_REVIEWED_MIGRATION.name)
  const seal = TEST_CALENDAR_DATE_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
