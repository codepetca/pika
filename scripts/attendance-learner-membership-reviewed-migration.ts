/** Exact source-only extension; this seal grants no execution, migration or
 * activation authority. Native checks and independent review remain separate. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const ATTENDANCE_LEARNER_MEMBERSHIP_REVIEWED_MIGRATION = Object.freeze({
  name: '286_attendance_learner_membership.sql',
  sha256: '0f48e7a99d9d8dbe8b5eb904d691c322e7c8de494f3fa848cbb5081f2f7e5ecc',
})

export function validateAttendanceLearnerMembershipReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = ATTENDANCE_LEARNER_MEMBERSHIP_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
