import assert from 'node:assert/strict'
import { validateTestOwnerUnpublicationReviewedMigration } from '../../scripts/test-owner-unpublication-reviewed-migration'
import { validateTestOwnerDeletionReviewedMigration } from '../../scripts/test-owner-deletion-reviewed-migration'
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateStudentTestSessionStatusReviewedMigration } from '../../scripts/student-test-session-status-reviewed-migration'
import { validateTestOwnerGradingReviewedMigration } from '../../scripts/test-owner-grading-reviewed-migration'
import { validateTestOwnerRecoveryReviewedMigration } from '../../scripts/test-owner-recovery-reviewed-migration'

/** Offline inputs for the exact historical learner profiles.
 * Copies real source bytes; this never runs a database or widens native admission. */
export function createOfflineTestLearnerRepository(repository: string, count: 257 | 258 = 257) {
  const migrations = join(repository, 'supabase', 'migrations')
  // Validate the complete source inventory before taking an explicit historical
  // prefix; malformed, duplicate or unknown-numeric source must not disappear.
  const inventory = loadAssignmentListReviewedMigrations(repository)
  assert([257, 258, 259, 260, 261, 262].includes(inventory.length), 'Unreviewed offline learner source profile')
  if (inventory.length >= 258) validateStudentTestSessionStatusReviewedMigration(inventory[257])
  if (inventory.length >= 259) validateTestOwnerGradingReviewedMigration(inventory[258])
  if (inventory.length >= 260) validateTestOwnerRecoveryReviewedMigration(inventory[259])
  if (inventory.length >= 261) validateTestOwnerUnpublicationReviewedMigration(inventory[260])
  if (inventory.length === 262) validateTestOwnerDeletionReviewedMigration(inventory[261])
  const names = inventory.slice(0, count).map(migration => migration.name)
  assert.deepEqual(names.map(name => Number(name.slice(0, 3))), Array.from({ length: count }, (_, index) => index + 1))
  assert.equal(names.at(-1), count === 257 ? '257_contextual_test_learner_workflow.sql' : '258_student_test_session_status_projection.sql')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pika-learner-native-offline-')))
  try {
    const destination = join(root, 'supabase', 'migrations')
    mkdirSync(destination, { recursive: true })
    for (const name of names) copyFileSync(join(migrations, name), join(destination, name))
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
  return { repository: root, dispose: () => rmSync(root, { recursive: true, force: true }) }
}
