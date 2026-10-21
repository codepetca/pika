/** Exact source-only attendance adoption extension. This seal grants no
 * migration, fixture execution, activation, or database application authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const ATTENDANCE_MEMBERSHIP_ADOPTION_REVIEWED_MIGRATION = Object.freeze({
  name: '285_attendance_membership_adoption.sql',
  sha256: '2e1ad28526d8ae4c7dca4303b2b0491234f27302a8bcff687eddc39455f630f5',
})

export function validateAttendanceMembershipAdoptionReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = ATTENDANCE_MEMBERSHIP_ADOPTION_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
