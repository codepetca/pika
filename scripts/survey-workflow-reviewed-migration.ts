/** Exact additive source seal; validation grants no native execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const SURVEY_WORKFLOW_REVIEWED_MIGRATION = Object.freeze({
  name: '263_contextual_surveys_workflow.sql',
  sha256: '1db152f8c33d239bf18b9fc61bab6da8896f2d9c88fa0fdce12c8671c30770c9',
})
export function validateSurveyWorkflowReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, SURVEY_WORKFLOW_REVIEWED_MIGRATION.name)
  const seal = SURVEY_WORKFLOW_REVIEWED_MIGRATION.sha256
  assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
