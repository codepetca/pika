/** Exact source-only271/272 extension. This does not grant migration, native
 * fixture, schema/catalog or activation authority. Historical seals stay owned
 * by their existing validators. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateAssignmentListMigrationChain } from './contextual-assignment-list-proof-lifecycle'

export const LIFECYCLE_SERVICES_REVIEWED_MIGRATIONS = Object.freeze([
  Object.freeze({ name: '271_contextual_archive_recovery.sql', sha256: '1ba29a7b56dfd078030c7fabf0b5061ebf46823263167e7307cb742fb1bfd049' }),
  Object.freeze({ name: '272_contextual_pal_classroom_member.sql', sha256: '8892d255d26afe904e420ad1402a1a1cb48f8837e02eca45d108cbf7fb9a9ed7' }),
] as const)

export function validateLifecycleServicesReviewedMigrations(migrations: readonly { name: string; sql: string; sha256: string }[]) {
  validateAssignmentListMigrationChain(migrations)
  if (migrations.length >= 271) assert([271, 272].includes(migrations.length), 'Unreviewed lifecycle services migration profile')
  for (const [index, seal] of LIFECYCLE_SERVICES_REVIEWED_MIGRATIONS.entries()) {
    if (migrations.length < 271 + index) continue
    const migration = migrations[270 + index]
    assert.equal(migration.name, seal.name)
    assert.equal(migration.sha256, seal.sha256)
    assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
  }
}
