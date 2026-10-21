import { createHash, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestLearnerWorkflowFixture } from '../../scripts/contextual-test-learner-proof-fixture'
import { newTestOwnerGradingFixture } from '../../scripts/contextual-test-owner-grading-proof-fixture'
import { newTestOwnerRecoveryFixture } from '../../scripts/contextual-test-owner-recovery-proof-fixture'
import { validateTestMemberListReviewedMigrations } from '../../scripts/check-contextual-test-member-list-lifecycle'
import { validateTestOwnerReorderReviewedMigrations } from '../../scripts/check-contextual-test-owner-reorder-lifecycle'
import { testLearnerNativePlan } from '../../scripts/contextual-test-learner-native-contracts'
import { testOwnerGradingNativePlan } from '../../scripts/contextual-test-owner-grading-native-contracts'
import { testOwnerRecoveryNativePlan } from '../../scripts/contextual-test-owner-recovery-native-contracts'
import { testOwnerUnpublicationNativePlan } from '../../scripts/contextual-test-owner-unpublication-native-contracts'
import { testOwnerDeletionNativePlan } from '../../scripts/contextual-test-owner-deletion-native-contracts'
import { classroomHotLifecycleNativePlan } from '../../scripts/contextual-classroom-hot-lifecycle-native-contracts'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'
import { GRADEBOOK_WORKFLOW_REVIEWED_MIGRATION, validateGradebookWorkflowReviewedMigration } from '../../scripts/gradebook-workflow-reviewed-migration'
import { LIFECYCLE_SERVICES_REVIEWED_MIGRATIONS, validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'
import { MATERIAL_RELEASE_SCHEDULING_REVIEWED_MIGRATION, validateMaterialReleaseSchedulingReviewedMigration } from '../../scripts/material-release-scheduling-reviewed-migration'
import { DATA_API_GRANTS_REVIEWED_MIGRATION, validateDataApiGrantsReviewedMigration } from '../../scripts/data-api-grants-reviewed-migration'

// Source-only construction: no runner, native adapter or database is invoked.
const repository = process.cwd(), head = 'a'.repeat(40)
const original = newAssignmentListProofFixture(new Date('2026-10-11T12:00:00Z'))
const digest = (sql: string) => createHash('sha256').update(sql).digest('hex')
const current = platform.loadAssignmentListReviewedMigrations(repository)
const observed = (fixture: { actors: readonly { id: string }[] }) => Object.freeze([1, 2].map(i =>
  Object.freeze({ actorId: fixture.actors[i].id, attemptId: randomUUID(), revision: 1 })))
const learner = observed(newTestLearnerWorkflowFixture(original))
const grading = observed(newTestOwnerGradingFixture(original))
const recovery = observed(newTestOwnerRecoveryFixture(original))
type SourceProfile = { name: string; validate: (migrations: typeof current) => void | {
  migrations: readonly { name: string; sha256: string }[]; migrationManifestSha256: string; nativeVerified: boolean
} }
const profiles: SourceProfile[] = [
  { name: 'member list', validate: (m: typeof current) => validateTestMemberListReviewedMigrations(m) },
  { name: 'owner reorder', validate: (m: typeof current) => validateTestOwnerReorderReviewedMigrations(m) },
  { name: 'learner', validate: () => testLearnerNativePlan(original, learner, head, repository) },
  { name: 'owner grading', validate: () => testOwnerGradingNativePlan(original, grading, head, repository) },
  { name: 'owner recovery', validate: () => testOwnerRecoveryNativePlan(original, recovery, head, repository) },
  { name: 'owner unpublication', validate: () => testOwnerUnpublicationNativePlan(original, head, repository) },
  { name: 'owner deletion', validate: () => testOwnerDeletionNativePlan(original, head, repository) },
  { name: 'hot archive restore', validate: () => classroomHotLifecycleNativePlan(original, head, repository) },
  { name: 'offline learner helper', validate: () => {
    const offline = createOfflineTestLearnerRepository(repository)
    offline.dispose()
  } },
]
afterEach(() => vi.restoreAllMocks())

describe.each(profiles)('$name reviewed283 source profile (offline)', ({ name, validate }) => {
  it('accepts the complete actual reviewed283 source chain', () => {
    expect(current).toHaveLength(283)
    expect(current[281]).toMatchObject(DATA_API_GRANTS_REVIEWED_MIGRATION)
    expect(current[282]).toMatchObject(MATERIAL_RELEASE_SCHEDULING_REVIEWED_MIGRATION)
    expect(current[268]).toMatchObject({ name: '269_contextual_surveys_workflow.sql',
      sha256: 'f67a65eb3e7017c44ae0f595e19d6aaa1d42a8af36f82b62ea499fdb616290c2' })
    expect(current[269]).toMatchObject(GRADEBOOK_WORKFLOW_REVIEWED_MIGRATION)
    expect(digest(current[268].sql)).toBe(current[268].sha256)
    expect(digest(current[269].sql)).toBe(current[269].sha256)
    for (const [index, seal] of LIFECYCLE_SERVICES_REVIEWED_MIGRATIONS.entries()) {
      expect(current[270 + index]).toMatchObject(seal)
      expect(digest(current[270 + index].sql)).toBe(seal.sha256)
    }
    const result = validate(current)
    if (result) {
      expect(result.migrations).toEqual(current.map(({ name, sha256 }) => ({ name, sha256 })))
      expect(result.migrationManifestSha256).toBe(digest(JSON.stringify(result.migrations)))
      expect(result.nativeVerified).toBe(false)
    }
  })
  const minimum: Record<string, number> = { 'member list': 253, 'owner reorder': 254, learner: 257, 'owner grading': 265,
    'owner recovery': 260, 'owner unpublication': 261, 'owner deletion': 262, 'hot archive restore': 268, 'offline learner helper': 257 }
  it.each([253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282].filter(count => count >= minimum[name]))(
    'preserves its reviewed historical%i prefix', count => {
      const migrations = current.slice(0, count)
      vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
      expect(() => validate(migrations)).not.toThrow()
    })
  it.each([268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))(
    'rejects changed $number $defect on the complete283 chain', ({ number, defect }) => {
      const migrations = current.map(m => ({ ...m })), tail = migrations[number - 1]
      if (defect === 'name') tail.name = `${number}_unknown.sql`
      if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
      if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
      if (defect === 'self-hashed-bytes') tail.sha256 = digest(tail.sql)
      vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
      expect(() => validate(migrations)).toThrow()
    })
  it('rejects a contiguous unknown284 tail', () => {
    const sql = 'select 1;'
    const migrations = [...current, { name: '284_unknown.sql', sql, sha256: digest(sql) }]
    vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    expect(() => validate(migrations)).toThrow()
  })
  it.each(['missing-tail', 'gap', 'duplicate', 'reordered'])('rejects a %s in the complete source inventory', defect => {
    const migrations = current.map(m => ({ ...m }))
    if (defect === 'missing-tail') migrations.splice(270, 1)
    if (defect === 'gap') migrations.splice(267, 1)
    if (defect === 'duplicate') migrations[271] = { ...migrations[270] }
    if (defect === 'reordered') [migrations[269], migrations[270]] = [migrations[270], migrations[269]]
    vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    expect(() => validate(migrations)).toThrow()
  })
})

describe('fixed Data API282 reviewed migration seal', () => {
  it('accepts the exact ACL migration without granting execution authority', () => {
    expect(() => validateDataApiGrantsReviewedMigration(current[281])).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('rejects changed %s', defect => {
    const candidate = { ...current[281] }
    if (defect === 'name') candidate.name = '282_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = digest(candidate.sql)
    expect(() => validateDataApiGrantsReviewedMigration(candidate)).toThrow()
  })
})

describe('reviewed283 offline learner prefix helper', () => {
  it.each([257, 258] as const)('preserves the explicit historical%i prefix after validating actual283', count => {
    const offline = createOfflineTestLearnerRepository(repository, count)
    try {
      expect(platform.loadAssignmentListReviewedMigrations(offline.repository)).toEqual(current.slice(0, count))
    } finally { offline.dispose() }
  })
  it.each([268, 269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 280, 281, 282, 283].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))(
    'rejects changed $number $defect before copying a historical prefix', ({ number, defect }) => {
      const migrations = current.map(m => ({ ...m })), tail = migrations[number - 1]
      if (defect === 'name') tail.name = `${number}_unknown.sql`
      if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
      if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
      if (defect === 'self-hashed-bytes') tail.sha256 = digest(tail.sql)
      vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
      expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
    })
  it('rejects a contiguous unknown284 tail before copying a historical prefix', () => {
    const sql = 'select 1;'
    vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue([...current,
      { name: '284_unknown.sql', sql, sha256: digest(sql) }])
    expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
  })
})

describe('fixed lifecycle271/272/273/274/275/276/277/278/279/280/281 reviewed migration seals', () => {
  it('retains all ten historical seals byte-for-byte and appends only the reviewed281 seal', () => {
    expect(LIFECYCLE_SERVICES_REVIEWED_MIGRATIONS.map(({name,sha256}) => [name,sha256])).toEqual([
      ['271_contextual_archive_recovery.sql','1ba29a7b56dfd078030c7fabf0b5061ebf46823263167e7307cb742fb1bfd049'],
      ['272_contextual_pal_classroom_member.sql','8892d255d26afe904e420ad1402a1a1cb48f8837e02eca45d108cbf7fb9a9ed7'],
      ['273_contextual_attendance_owner_policy_read.sql','24a46677bac2ef13319fab6f1c81b77197140a514dffa413377d2c396ca25284'],
      ['274_contextual_attendance_owner_policy_write.sql','a906e4cb19c29cbc0e889577a87f1384fcb9b482f3d3bc6cf0336adcc011d0f9'],
      ['275_contextual_attendance_owner_session_read.sql','49104640e82ee0d359ad56c88906773475d57d4738e0213b508004fd18ff5ed9'],
      ['276_contextual_attendance_owner_report_read.sql','8ad17a6f3a100c8c581b574d81d735ded79a1ff5aae245660e8ae44d75244dbc'],
      ['277_contextual_classroom_owner_list_reorder.sql','957b844652288ef84b66b5960d632a1c9a874602038962be481fa045418335b3'],
      ['278_contextual_classroom_authoring_guidance_read.sql','d315df11d4359751e52dfa0f4942546bb1677328dbfa43b86f11ca5c8f9b8c36'],
      ['279_contextual_classroom_guidance_preview.sql','7542ae0d907691a0e46044790c73523dcff2782821c0a7370a86b4342a898bf3'],
      ['280_contextual_classroom_guidance_adoption.sql','5786e1b83b3caed6a369f4a497aab5b296cdcee6fc918c12a7e031fcfce29555'],
      ['281_attendance_decommission_retained_generations.sql','99dac4f2bc3324f92fbd30ba0bc75dc6458e5c699cdc07613f0d5aeb37ad302e'],
    ])
  })
  it.each([271,272,273,274,275,276,277,278,279,280,281].flatMap(number => ['name','digest','bytes','self-hashed-bytes'].map(defect => ({number,defect}))))(
    'directly rejects changed lifecycle $number $defect', ({number,defect}) => {
      const migrations=current.map(m=>({...m})),tail=migrations[number-1]
      if(defect==='name')tail.name=`${number}_unknown.sql`
      if(defect==='digest')tail.sha256='f'.repeat(64)
      if(defect==='bytes'||defect==='self-hashed-bytes')tail.sql+='\n'
      if(defect==='self-hashed-bytes')tail.sha256=digest(tail.sql)
      expect(()=>validateLifecycleServicesReviewedMigrations(migrations)).toThrow()
    })
  it('validates all eleven exact source additions and rejects an unknown future tail', () => {
    expect(() => validateLifecycleServicesReviewedMigrations(current)).not.toThrow()
    const sql = 'select 1;'
    expect(() => validateLifecycleServicesReviewedMigrations([...current, { name: '284_unknown.sql', sql, sha256: digest(sql) }])).toThrow()
  })
})

// Exact filename, stored digest and raw bytes must all match the fixed seal.
describe('fixed Gradebook270 reviewed migration seal', () => {
  it('accepts only exact current reviewed bytes without granting execution authority', () => {
    expect(() => validateGradebookWorkflowReviewedMigration(current[269])).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('rejects altered %s', defect => {
    const candidate = { ...current[269] }
    if (defect === 'name') candidate.name = '270_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = digest(candidate.sql)
    expect(() => validateGradebookWorkflowReviewedMigration(candidate)).toThrow()
  })
})


describe('fixed material scheduling283 reviewed migration seal', () => {
  it('accepts exact reviewed bytes without granting execution authority', () => {
    expect(() => validateMaterialReleaseSchedulingReviewedMigration(current[282])).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('rejects changed %s', defect => {
    const candidate = { ...current[282] }
    if (defect === 'name') candidate.name = '283_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = digest(candidate.sql)
    expect(() => validateMaterialReleaseSchedulingReviewedMigration(candidate)).toThrow()
  })
})
