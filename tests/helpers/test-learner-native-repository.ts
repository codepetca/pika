import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'
import { validateGradebookWorkflowReviewedMigration } from '../../scripts/gradebook-workflow-reviewed-migration'
import { validateGradebookCompactZeroWeightAssessmentsReviewedMigration } from '../../scripts/gradebook-compact-zero-weight-assessments-reviewed-migration'
import { validateClassroomHotLifecycleReviewedMigration } from '../../scripts/classroom-hot-lifecycle-reviewed-migration'
import { validateSurveyWorkflowReviewedMigration } from '../../scripts/survey-workflow-reviewed-migration'
import { validateGradebookZeroWeightStudentVisibilityReviewedMigration } from '../../scripts/gradebook-zero-weight-student-visibility-reviewed-migration'
import { validateTestReturnUngradedWorkReviewedMigration } from '../../scripts/test-return-ungraded-work-reviewed-migration'
import { validateTestAiGradingSavedWorkReviewedMigration } from '../../scripts/test-ai-grading-saved-work-reviewed-migration'
import { validateTestCalendarDateReviewedMigration } from '../../scripts/test-calendar-date-reviewed-migration'
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
  assert([257, 258, 259, 260, 261, 262,263, 264, 265, 266, 267, 268, 269,270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282].includes(inventory.length), 'Unreviewed offline learner source profile')
  if (inventory.length >= 258) validateStudentTestSessionStatusReviewedMigration(inventory[257])
  if (inventory.length >= 259) validateTestOwnerGradingReviewedMigration(inventory[258])
  if (inventory.length >= 260) validateTestOwnerRecoveryReviewedMigration(inventory[259])
  if (inventory.length >= 261) validateTestOwnerUnpublicationReviewedMigration(inventory[260])
  if (inventory.length >= 262) validateTestOwnerDeletionReviewedMigration(inventory[261])
  if (inventory.length >= 263) validateTestCalendarDateReviewedMigration(inventory[262])
  if (inventory.length >= 264) validateTestAiGradingSavedWorkReviewedMigration(inventory[263])
  if (inventory.length >= 265) validateTestReturnUngradedWorkReviewedMigration(inventory[264])
  if (inventory.length >= 266) validateGradebookZeroWeightStudentVisibilityReviewedMigration(inventory[265])
  if (inventory.length >= 267) validateGradebookCompactZeroWeightAssessmentsReviewedMigration(inventory[266])
  if (inventory.length >= 268) validateClassroomHotLifecycleReviewedMigration(inventory[267])
  if (inventory.length >= 269) validateSurveyWorkflowReviewedMigration(inventory[268])
  if (inventory.length >= 270) validateGradebookWorkflowReviewedMigration(inventory[269])
  validateLifecycleServicesReviewedMigrations(inventory)
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
