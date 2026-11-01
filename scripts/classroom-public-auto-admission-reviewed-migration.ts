/** Exact source seal only. This does not establish native database proof,
 * authorize migration, activation, account admission, or provider changes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_MIGRATION = Object.freeze({
  name: '297_classroom_public_auto_admission.sql',
  sha256: 'e7ee574ff2cb2d97deec109b4bbea49a564a892a3db8a7748db21a92745a5be1',
})
export const CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_TABLES = Object.freeze([
  'private.classroom_public_auto_admission_policy',
] as const)

export function validateClassroomPublicAutoAdmissionReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert(migration, 'Reviewed public auto-admission migration absent')
  const seal = CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
