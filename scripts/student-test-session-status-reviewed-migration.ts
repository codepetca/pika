/** Exact reviewed read-only function addition; existing table catalogs stay unchanged.
 * Source validation only: this module never grants native execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const STUDENT_TEST_SESSION_STATUS_REVIEWED_MIGRATION = Object.freeze({
  name: '258_student_test_session_status_projection.sql',
  sha256: '7e251740234687bfc9a429e9268e1edb6b331016474a96f3a2a0fe82e718737f',
})

export function validateStudentTestSessionStatusReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, STUDENT_TEST_SESSION_STATUS_REVIEWED_MIGRATION.name)
  assert.equal(migration.sha256, STUDENT_TEST_SESSION_STATUS_REVIEWED_MIGRATION.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), STUDENT_TEST_SESSION_STATUS_REVIEWED_MIGRATION.sha256)
}
