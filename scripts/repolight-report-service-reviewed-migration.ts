/** Exact source seal only. Fixture execution, schema application, gates and
 * provider operations retain their independent authority and runtime guards. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION = Object.freeze({
  name: '293_repolight_report_service.sql',
  sha256: '83b3a208125dcb13aab471e691139111daf552e534a83e3d4f8bfb6692c11dbf',
})
export function validateRepoLightReportServiceReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
