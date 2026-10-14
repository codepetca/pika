/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const TEST_RETURN_UNGRADED_WORK_REVIEWED_MIGRATION = Object.freeze({
  name: '265_test_return_ungraded_work.sql',
  sha256: 'aa5a34840c33669c62381a3e568e4a4639708c8027cdbdb15646152352c2f9d3',
})
export function validateTestReturnUngradedWorkReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, TEST_RETURN_UNGRADED_WORK_REVIEWED_MIGRATION.name)
  const seal = TEST_RETURN_UNGRADED_WORK_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/)
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
