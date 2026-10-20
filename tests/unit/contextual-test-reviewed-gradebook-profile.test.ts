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

describe.each(profiles)('$name reviewed272 source profile (offline)', ({ name, validate }) => {
  it('accepts the complete actual reviewed272 source chain', () => {
    expect(current).toHaveLength(272)
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
  it.each([253, 254, 255, 256, 257, 258, 259, 260, 261, 262, 263, 264, 265, 266, 267, 268, 269, 270, 271].filter(count => count >= minimum[name]))(
    'preserves its reviewed historical%i prefix', count => {
      const migrations = current.slice(0, count)
      vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
      expect(() => validate(migrations)).not.toThrow()
    })
  it.each([268, 269, 270, 271, 272].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))(
    'rejects changed $number $defect on the complete272 chain', ({ number, defect }) => {
      const migrations = current.map(m => ({ ...m })), tail = migrations[number - 1]
      if (defect === 'name') tail.name = `${number}_unknown.sql`
      if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
      if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
      if (defect === 'self-hashed-bytes') tail.sha256 = digest(tail.sql)
      vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
      expect(() => validate(migrations)).toThrow()
    })
  it('rejects a contiguous unknown273 tail', () => {
    const sql = 'select 1;'
    const migrations = [...current, { name: '273_unknown.sql', sql, sha256: digest(sql) }]
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

describe('reviewed272 offline learner prefix helper', () => {
  it.each([257, 258] as const)('preserves the explicit historical%i prefix after validating actual272', count => {
    const offline = createOfflineTestLearnerRepository(repository, count)
    try {
      expect(platform.loadAssignmentListReviewedMigrations(offline.repository)).toEqual(current.slice(0, count))
    } finally { offline.dispose() }
  })
  it.each([268, 269, 270, 271, 272].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))(
    'rejects changed $number $defect before copying a historical prefix', ({ number, defect }) => {
      const migrations = current.map(m => ({ ...m })), tail = migrations[number - 1]
      if (defect === 'name') tail.name = `${number}_unknown.sql`
      if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
      if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
      if (defect === 'self-hashed-bytes') tail.sha256 = digest(tail.sql)
      vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
      expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
    })
  it('rejects a contiguous unknown273 tail before copying a historical prefix', () => {
    const sql = 'select 1;'
    vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue([...current,
      { name: '273_unknown.sql', sql, sha256: digest(sql) }])
    expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
  })
})

describe('fixed lifecycle271/272 reviewed migration seals', () => {
  it('validates both exact source additions and rejects an unknown future tail', () => {
    expect(() => validateLifecycleServicesReviewedMigrations(current)).not.toThrow()
    const sql = 'select 1;'
    expect(() => validateLifecycleServicesReviewedMigrations([...current, { name: '273_unknown.sql', sql, sha256: digest(sql) }])).toThrow()
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
