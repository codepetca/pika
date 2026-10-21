/** Exact source-only271–283 extension. This does not grant migration, native
 * fixture, schema/catalog or activation authority. Historical seals stay owned
 * by their existing validators. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateAssignmentListMigrationChain } from './contextual-assignment-list-proof-lifecycle'
import { validateDataApiGrantsReviewedMigration } from './data-api-grants-reviewed-migration'

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
  Object.freeze({ name: '280_contextual_classroom_guidance_adoption.sql', sha256: '5786e1b83b3caed6a369f4a497aab5b296cdcee6fc918c12a7e031fcfce29555' }),
  Object.freeze({ name: '281_attendance_decommission_retained_generations.sql', sha256: '99dac4f2bc3324f92fbd30ba0bc75dc6458e5c699cdc07613f0d5aeb37ad302e' }),
  Object.freeze({ name: '283_attendance_current_membership_foundation.sql', sha256: 'a464c8285cbc08755fa03d6b33b08342310089226d6ea0517c82fcd0271012ab' }),
] as const)

export function validateLifecycleServicesReviewedMigrations(migrations: readonly { name: string; sql: string; sha256: string }[]) {
  validateAssignmentListMigrationChain(migrations)
  if (migrations.length >= 271) assert([271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283].includes(migrations.length), 'Unreviewed lifecycle services migration profile')
  for (const seal of LIFECYCLE_SERVICES_REVIEWED_MIGRATIONS) {
    // Data API282 has its own validator; attendance283 follows that exact slot.
    const number = Number(seal.name.slice(0, 3))
    if (migrations.length < number) continue
    const migration = migrations[number - 1]
    assert.equal(migration.name, seal.name)
    assert.equal(migration.sha256, seal.sha256)
    assert.equal(createHash('sha256').update(migration.sql).digest('hex'), seal.sha256)
  }
  if (migrations.length >= 282) validateDataApiGrantsReviewedMigration(migrations[281])
}
