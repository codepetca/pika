/** Exact source seal only. No schema application, cohort import, growth policy,
 * runtime cutover or provider authority is granted by accepting these bytes. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const CLASSROOM_ADMISSION_REGISTRY_REVIEWED_MIGRATION = Object.freeze({
  name: '294_classroom_experience_admission_registry.sql',
  sha256: '129a6521dfe25846ec923f91bda2b1b123a0dec7df7d42690ccae5e137ae07de',
})
// Literal reviewed catalog: private control/evidence rows participate in every
// whole-row preservation proof just as existing application tables do.
export const CLASSROOM_ADMISSION_REGISTRY_REVIEWED_TABLES = Object.freeze([
  'private.classroom_experience_admission_policy',
  'private.classroom_experience_admission_batches',
  'private.classroom_experience_admission_grants',
  'private.classroom_experience_admission_exclusions',
])
export function validateClassroomAdmissionRegistryReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = CLASSROOM_ADMISSION_REGISTRY_REVIEWED_MIGRATION
  assert(migration, 'Reviewed classroom admission migration absent')
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
