/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const TEST_CALENDAR_DATE_REVIEWED_MIGRATION = Object.freeze({
  name: '263_test_calendar_date.sql',
  sha256: '7d9e180a7930877f248b3969d8f4621336fead5416682c09c88c6392a3c3c8c2',
})
export function validateTestCalendarDateReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_CALENDAR_DATE_REVIEWED_MIGRATION.name)
  const seal = TEST_CALENDAR_DATE_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
