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
const profiles = [
  { name: 'member list', validate: (m: typeof current) => validateTestMemberListReviewedMigrations(m) },
  { name: 'owner reorder', validate: (m: typeof current) => validateTestOwnerReorderReviewedMigrations(m) },
  { name: 'learner', validate: () => testLearnerNativePlan(original, learner, head, repository) },
  { name: 'owner grading', validate: () => testOwnerGradingNativePlan(original, grading, head, repository) },
  { name: 'owner recovery', validate: () => testOwnerRecoveryNativePlan(original, recovery, head, repository) },
  { name: 'owner unpublication', validate: () => testOwnerUnpublicationNativePlan(original, head, repository) },
  { name: 'owner deletion', validate: () => testOwnerDeletionNativePlan(original, head, repository) },
  { name: 'hot archive restore', validate: () => classroomHotLifecycleNativePlan(original, head, repository) },
]
afterEach(() => vi.restoreAllMocks())

describe.each(profiles)('$name reviewed269 source profile (offline)', ({ validate }) => {
  it('accepts the complete actual reviewed269 source chain', () => {
    expect(current).toHaveLength(269)
    expect(current[268]).toMatchObject({ name: '269_contextual_surveys_workflow.sql',
      sha256: 'f67a65eb3e7017c44ae0f595e19d6aaa1d42a8af36f82b62ea499fdb616290c2' })
    expect(digest(current[268].sql)).toBe(current[268].sha256)
    const result = validate(current)
    if (result) {
      expect(result.migrations).toEqual(current.map(({ name, sha256 }) => ({ name, sha256 })))
      expect(result.migrationManifestSha256).toBe(digest(JSON.stringify(result.migrations)))
      expect(result.nativeVerified).toBe(false)
    }
  })
  it.each([268, 269].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))(
    'rejects changed $number $defect on the complete269 chain', ({ number, defect }) => {
      const migrations = current.map(m => ({ ...m })), tail = migrations[number - 1]
      if (defect === 'name') tail.name = `${number}_unknown.sql`
      if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
      if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
      if (defect === 'self-hashed-bytes') tail.sha256 = digest(tail.sql)
      vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
      expect(() => validate(migrations)).toThrow()
    })
  it('rejects a contiguous unknown270 tail', () => {
    const sql = 'select 1;'
    const migrations = [...current, { name: '270_unknown.sql', sql, sha256: digest(sql) }]
    vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
    expect(() => validate(migrations)).toThrow()
  })
})

describe('reviewed269 offline learner prefix helper', () => {
  it.each([257, 258] as const)('preserves the explicit historical%i prefix after validating actual269', count => {
    const offline = createOfflineTestLearnerRepository(repository, count)
    try {
      expect(platform.loadAssignmentListReviewedMigrations(offline.repository)).toEqual(current.slice(0, count))
    } finally { offline.dispose() }
  })
  it.each([268, 269].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))(
    'rejects changed $number $defect before copying a historical prefix', ({ number, defect }) => {
      const migrations = current.map(m => ({ ...m })), tail = migrations[number - 1]
      if (defect === 'name') tail.name = `${number}_unknown.sql`
      if (defect === 'digest') tail.sha256 = 'f'.repeat(64)
      if (defect === 'bytes' || defect === 'self-hashed-bytes') tail.sql += '\n'
      if (defect === 'self-hashed-bytes') tail.sha256 = digest(tail.sql)
      vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(migrations)
      expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
    })
  it('rejects a contiguous unknown270 tail before copying a historical prefix', () => {
    const sql = 'select 1;'
    vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue([...current,
      { name: '270_unknown.sql', sql, sha256: digest(sql) }])
    expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
  })
})
