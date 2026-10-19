/** Fixed source seal; validation is not database execution authority. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
export const SURVEY_WORKFLOW_REVIEWED_MIGRATION = Object.freeze({
  name: '269_contextual_surveys_workflow.sql',
  sha256: 'f67a65eb3e7017c44ae0f595e19d6aaa1d42a8af36f82b62ea499fdb616290c2',
})
export function validateSurveyWorkflowReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  assert.equal(migration.name, SURVEY_WORKFLOW_REVIEWED_MIGRATION.name)
  const seal = SURVEY_WORKFLOW_REVIEWED_MIGRATION.sha256
  assert.match(seal, /^[a-f0-9]{64}$/); assert.equal(migration.sha256, seal)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal)
}
