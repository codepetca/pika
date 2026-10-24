/** Exact source seal only. Fixture execution, schema application, gates and
 * provider operations retain their independent authority and runtime guards. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION = Object.freeze({
  name: '293_repolight_report_service.sql',
  sha256: '62aec9110c4e8a46c1c05d92fad8ef797794652cf064497edb7b16943d8664da',
})
export function validateRepoLightReportServiceReviewedMigration(migration: { name: string; sql: string; sha256: string }) {
  const seal = REPOLIGHT_REPORT_SERVICE_REVIEWED_MIGRATION
  assert.equal(migration.name, seal.name)
  assert.equal(migration.sha256, seal.sha256)
  assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
}
