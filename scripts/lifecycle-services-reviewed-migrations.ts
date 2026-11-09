import { validateClassroomPublicAutoAdmissionReviewedMigration } from './classroom-public-auto-admission-reviewed-migration'
import { validateAttendanceNamedSchedulesReviewedMigration } from './attendance-named-schedules-reviewed-migration'
import { validateIndependentCalendarPostDatesReviewedMigration } from './independent-calendar-post-dates-reviewed-migration'
import { validateClassroomAdmissionRegistryReviewedMigration } from './classroom-admission-registry-reviewed-migration'
import { validateTeacherAuthoringImagesReviewedMigration } from './teacher-authoring-images-reviewed-migration'
/** Exact source-only271–301 extension. This does not grant migration, native
 * fixture, schema/catalog or activation authority. Historical seals stay owned
 * by their existing validators. */
import { validateAnnouncementPostDateReviewedMigration } from './announcement-post-date-reviewed-migration'
import { validateClassroomHomeVisibilityReviewedMigration } from './classroom-home-visibility-reviewed-migration'
import { validateRepoLightReportServiceReviewedMigration } from './repolight-report-service-reviewed-migration'
import { validateMaterialPostDateReviewedMigration } from './material-post-date-reviewed-migration'
import { validateMaterialReleaseSchedulingReviewedMigration } from './material-release-scheduling-reviewed-migration'
import { validateAttendanceMembershipAdoptionReviewedMigration } from './attendance-membership-adoption-reviewed-migration'
import { validateAttendanceLearnerMembershipReviewedMigration } from './attendance-learner-membership-reviewed-migration'
import { validatePalOwnerQueueStopReviewedMigration } from './pal-owner-queue-stop-reviewed-migration'
import { validateContextualRemovedMembershipCleanupReviewedMigration } from './contextual-removed-membership-cleanup-reviewed-migration'
import assert from 'node:assert/strict'
import disposableBillingReplayTail from './disposable-billing-replay-tail.json'
import disposableClassroomCutoffReplayTail from './disposable-classroom-cutoff-replay-tail.json'
import disposableAssignmentReleaseReplayTail from './disposable-assignment-release-replay-tail.json'
import disposableLiveTrialReplayTail from './disposable-live-trial-replay-tail.json'
import disposableLivePaymentReplayTail from './disposable-live-payment-replay-tail.json'
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
  if (migrations.length >= 271) assert([271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283, 284, 285, 286, 287, 288, 289, 290, 291, 292, 293, 294, 295, 296, 297, 298, 299, 300, 301].includes(migrations.length), 'Unreviewed lifecycle services migration profile')
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
  if (migrations.length >= 284) validateMaterialReleaseSchedulingReviewedMigration(migrations[283])
  if (migrations.length >= 285) validateAttendanceMembershipAdoptionReviewedMigration(migrations[284])
  if (migrations.length >= 286) validateAttendanceLearnerMembershipReviewedMigration(migrations[285])
  if (migrations.length >= 287) validatePalOwnerQueueStopReviewedMigration(migrations[286])
  if (migrations.length >= 288) validateContextualRemovedMembershipCleanupReviewedMigration(migrations[287])
  if (migrations.length >= 289) validateMaterialPostDateReviewedMigration(migrations[288])
  if (migrations.length >= 290) validateAnnouncementPostDateReviewedMigration(migrations[289])
  if (migrations.length >= 291) validateTeacherAuthoringImagesReviewedMigration(migrations[290])
  if (migrations.length >= 292) validateClassroomHomeVisibilityReviewedMigration(migrations[291])
  if (migrations.length >= 293) validateRepoLightReportServiceReviewedMigration(migrations[292])
  if (migrations.length >= 294) validateClassroomAdmissionRegistryReviewedMigration(migrations[293])
  if (migrations.length >= 295) validateIndependentCalendarPostDatesReviewedMigration(migrations[294])
  if (migrations.length >= 296) validateAttendanceNamedSchedulesReviewedMigration(migrations[295])
  if (migrations.length >= 297) validateClassroomPublicAutoAdmissionReviewedMigration(migrations[296])
  for (const [index, name, digest] of [
    [297, '298_repolight_analysis_access.sql', '63d94e7f301180ff0524e0c0f0214899bb3e048ea303af0b88ede647344cf492'],
    [298, '299_repolight_managed_registry.sql', '8710a091f0d32447074d84b945175a764cba1e0a3f364deb1b845d9d2661788b'],
    [299, '300_repolight_provision_outbox.sql', '47a20f34e9fd03e6b9d8a0e07960c7eb9e199e02ccc09839bd17ac81b98baacf'],
    [300, '301_repolight_universal_tier_benefit.sql', '871db1a388284f8a4178f7d36385b7db267c26b0b936bdd25a78f85ac24956e3'],
  ] as const) {
    if (migrations.length <= index) continue
    const migration = migrations[index]
    assert.equal(migration.name, name)
    assert.equal(migration.sha256, digest)
    assert.equal(createHash('sha256').update(migration.sql).digest('hex'), digest)
  }
}

/** Application-routine changes admitted only by the disposable database runners.
 * The historical lifecycle and native proof validators remain closed at 301.
 */
export function validateDisposableBillingReplayMigrations(migrations: Parameters<typeof validateLifecycleServicesReviewedMigrations>[0]) {
  validateLifecycleServicesReviewedMigrations(migrations.slice(0, 301))
  if (migrations.length <= 301) return

  assert([303, 304, 307, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325].includes(migrations.length), 'Expected a complete billing replay through migration 303, 304, 307, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324 or 325')
  assert.equal(createHash('sha256').update(JSON.stringify(disposableBillingReplayTail)).digest('hex'),
    '34300b3689fb206fba1ec60296d184c32024cdf2466e690ad9c4b0fb2821b80d', 'Unreviewed billing replay seal')
  assert.equal(disposableBillingReplayTail.length, 6)
  for (const [offset, { name, sha256 }] of disposableBillingReplayTail.slice(0, Math.min(migrations.length - 301, 6)).entries()) {
    const migration = migrations[301 + offset]
    assert.equal(migration.name, name)
    assert.equal(migration.sha256, sha256)
    assert.equal(createHash('sha256').update(migration.sql).digest('hex'), sha256)
  }
  if (migrations.length >= 310) {
    assert.equal(createHash('sha256').update(JSON.stringify(disposableClassroomCutoffReplayTail)).digest('hex'),
      '88085cc556ede00ad3cd9b295e2f0242428a3ec85189d08b736681648abcee44', 'Unreviewed classroom cutoff replay seal')
    assert.equal(disposableClassroomCutoffReplayTail.length, 3)
    for (const [offset, { name, sha256 }] of disposableClassroomCutoffReplayTail.entries()) {
      const migration = migrations[307 + offset]
      assert.equal(migration.name, name)
      assert.equal(migration.sha256, sha256)
      assert.equal(createHash('sha256').update(migration.sql).digest('hex'), sha256)
    }
  }
  if (migrations.length >= 311) {
    assert.equal(createHash('sha256').update(JSON.stringify(disposableAssignmentReleaseReplayTail)).digest('hex'),
      '3380e8783aecbde7362d33cc5c481b616cfa91c2cce6f975781df931a4245a85', 'Unreviewed assignment release replay seal')
    assert.equal(disposableAssignmentReleaseReplayTail.length, 2)
    for (const [offset, { name, sha256 }] of disposableAssignmentReleaseReplayTail.slice(0, migrations.length - 310).entries()) {
      const migration = migrations[310 + offset]
      assert.equal(migration.name, name)
      assert.equal(migration.sha256, sha256)
      assert.equal(createHash('sha256').update(migration.sql).digest('hex'), sha256)
    }
  }
  if (migrations.length >= 313) {
    assert.equal(createHash('sha256').update(JSON.stringify(disposableLiveTrialReplayTail)).digest('hex'),
      '1350073dac51c21c697dfa4e3cdf2c2fd833d4396c71944aaca9c2e112a1ce54', 'Unreviewed live trial replay seal')
    assert.equal(disposableLiveTrialReplayTail.length, 1)
    const { name, sha256 } = disposableLiveTrialReplayTail[0]
    const migration = migrations[312]
    assert.equal(migration.name, name)
    assert.equal(migration.sha256, sha256)
    assert.equal(createHash('sha256').update(migration.sql).digest('hex'), sha256)
  }
  if (migrations.length >= 314) {
    assert.equal(createHash('sha256').update(JSON.stringify(disposableLivePaymentReplayTail)).digest('hex'),
      '5a542557c8bace3487943ff4607bb816c18ce33fec41d1c313427cbf3cda6f63', 'Unreviewed live payment replay seal')
    assert.equal(disposableLivePaymentReplayTail.length, 12)
    for (const [offset, { name, sha256 }] of disposableLivePaymentReplayTail.slice(0, migrations.length - 313).entries()) {
      const migration = migrations[313 + offset]
      assert.equal(migration.name, name)
      assert.equal(migration.sha256, sha256)
      assert.equal(createHash('sha256').update(migration.sql).digest('hex'), sha256)
    }
  }
}
