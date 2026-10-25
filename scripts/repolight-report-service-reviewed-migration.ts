/** Exact source seal only. Fixture execution, schema application, gates and
 * provider operations retain their independent authority and runtime guards. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION = Object.freeze({
  name: '293_repolight_report_service.sql',
  sha256: 'b03d4dccd88ecbbf06d103b57c0cee97fccd6b07f13dfc2b0a4ed438fd68d052',
})
// Literal table inventory of the sealed migration, including private state.
// Proofs must fingerprint all of these tables rather than exempt the family.
export const REPOLIGHT_REPORT_SERVICE_REVIEWED_TABLES = Object.freeze([
  'private.repolight_settings',
  'private.repolight_subject_bindings',
  'public.assignment_repolight_runs',
  'public.assignment_repolight_reports',
  'public.assignment_repolight_feedback_imports',
  'private.repolight_purge_admissions',
  'private.repolight_purge_reservations',
  'private.repolight_purge_subjects',
  'private.repolight_decommission_intents',
  'private.repolight_assignment_delete_capabilities',
])
export function validateRepoLightReportServiceReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
