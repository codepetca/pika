/** Exact source-only271–280 extension. This does not grant migration, native
 * fixture, schema/catalog or activation authority. Historical seals stay owned
 * by their existing validators. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateAssignmentListMigrationChain } from './contextual-assignment-list-proof-lifecycle'

export const LIFECYCLE_SERVICES_REVIEWED_MIGRATIONS = Object.freeze([
  Object.freeze({ name: '271_contextual_archive_recovery.sql', sha256: '1ba29a7b56dfd078030c7fabf0b5061ebf46823263167e7307cb742fb1bfd049' }),
  Object.freeze({ name: '272_contextual_pal_classroom_member.sql', sha256: '8892d255d26afe904e420ad1402a1a1cb48f8837e02eca45d108cbf7fb9a9ed7' }),
  Object.freeze({ name: '273_contextual_attendance_owner_policy_read.sql', sha256: '24a46677bac2ef13319fab6f1c81b77197140a514dffa413377d2c396ca25284' }),
  Object.freeze({ name: '274_contextual_attendance_owner_policy_write.sql', sha256: 'a906e4cb19c29cbc0e889577a87f1384fcb9b482f3d3bc6cf0336adcc011d0f9' }),
  Object.freeze({ name: '275_contextual_attendance_owner_session_read.sql', sha256: '49104640e82ee0d359ad56c88906773475d57d4738e0213b508004fd18ff5ed9' }),
  Object.freeze({ name: '276_contextual_attendance_owner_report_read.sql', sha256: '8ad17a6f3a100c8c581b574d81d735ded79a1ff5aae245660e8ae44d75244dbc' }),
  Object.freeze({ name: '277_contextual_classroom_owner_list_reorder.sql', sha256: '957b844652288ef84b66b5960d632a1c9a874602038962be481fa045418335b3' }),
  Object.freeze({ name: '278_contextual_classroom_authoring_guidance_read.sql', sha256: 'd315df11d4359751e52dfa0f4942546bb1677328dbfa43b86f11ca5c8f9b8c36' }),
  Object.freeze({ name: '279_contextual_classroom_guidance_preview.sql', sha256: '7542ae0d907691a0e46044790c73523dcff2782821c0a7370a86b4342a898bf3' }),
  Object.freeze({ name: '280_contextual_classroom_guidance_adoption.sql', sha256: 'f3b1f552a3d7fd34ed56c6a3b1d0f8107a10393a522b0cf251ab2d7657faba9b' }),
] as const)

export function validateLifecycleServicesReviewedMigrations(migrations: readonly { name: string; sql: string; sha256: string }[]) {
  validateAssignmentListMigrationChain(migrations)
  if (migrations.length >= 271) assert([271, 272, 273, 274, 275, 276, 277, 278, 279, 280].includes(migrations.length), 'Unreviewed lifecycle services migration profile')
  for (const [index, seal] of LIFECYCLE_SERVICES_REVIEWED_MIGRATIONS.entries()) {
    if (migrations.length < 271 + index) continue
    const migration = migrations[270 + index]
    assert.equal(migration.name, seal.name)
    assert.equal(migration.sha256, seal.sha256)
    assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
  }
}
