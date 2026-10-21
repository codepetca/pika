/** Exact source-only extension; this seal grants no execution, migration or
 * activation authority. Native checks and independent review remain separate. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const ATTENDANCE_LEARNER_MEMBERSHIP_REVIEWED_MIGRATION = Object.freeze({
  name: '286_attendance_learner_membership.sql',
  sha256: 'd938a5d37baf65bcf3de6847d2c37eda5bc711fd1e9b120a6e792feb9e66b019',
})

export function validateAttendanceLearnerMembershipReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = ATTENDANCE_LEARNER_MEMBERSHIP_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
