/** Exact source-only291 admission. This grants no database application, native
 * fixture execution, activation, or acceptance authority. Historical seals stay fixed. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const TEACHER_AUTHORING_IMAGES_REVIEWED_MIGRATION = Object.freeze({
  name: '291_teacher_authoring_images.sql',
  sha256: '016ae0051081bf1c16aa985c168f75db4aae273b41c870949f06255ba994bbf3',
})

export function validateTeacherAuthoringImagesReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = TEACHER_AUTHORING_IMAGES_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
