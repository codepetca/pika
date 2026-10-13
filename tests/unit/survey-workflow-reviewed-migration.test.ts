import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { SURVEY_WORKFLOW_REVIEWED_MIGRATION, validateSurveyWorkflowReviewedMigration } from '../../scripts/survey-workflow-reviewed-migration'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { newTestLearnerWorkflowFixture } from '../../scripts/contextual-test-learner-proof-fixture'
import { testLearnerNativePlan } from '../../scripts/contextual-test-learner-native-contracts'
import { testOwnerGradingNativePlan } from '../../scripts/contextual-test-owner-grading-native-contracts'
import { testOwnerRecoveryNativePlan } from '../../scripts/contextual-test-owner-recovery-native-contracts'
import { testOwnerUnpublicationNativePlan } from '../../scripts/contextual-test-owner-unpublication-native-contracts'
import { testOwnerDeletionNativePlan } from '../../scripts/contextual-test-owner-deletion-native-contracts'
import { validateTestMemberListReviewedMigrations } from '../../scripts/check-contextual-test-member-list-lifecycle'
import { validateTestOwnerReorderReviewedMigrations } from '../../scripts/check-contextual-test-owner-reorder-lifecycle'

const digest = (sql: string) => createHash('sha256').update(sql).digest('hex')
const repository = process.cwd(), current = platform.loadAssignmentListReviewedMigrations(repository)
const original = newAssignmentListProofFixture(new Date('2026-10-12T12:00:00Z')), fixture = newTestLearnerWorkflowFixture(original)
// CPU-only observed-shaped IDs. They do not certify real Start or bootstrap.
const observed = Object.freeze([1, 2].map(i => Object.freeze({ actorId: fixture.actors[i].id,
  attemptId: `facecafe-0000-4000-8000-${String(i).padStart(12, '0')}`, revision: 1 })))
const head = 'b'.repeat(40)
const factories = [
  ['learner', () => testLearnerNativePlan(original, observed, head, repository)],
  ['grading', () => testOwnerGradingNativePlan(original, observed, head, repository)],
  ['recovery', () => testOwnerRecoveryNativePlan(original, observed, head, repository)],
  ['unpublication', () => testOwnerUnpublicationNativePlan(original, head, repository)],
  ['deletion', () => testOwnerDeletionNativePlan(original, head, repository)],
] as const
const defects = ['name263', 'digest263', 'bytes263', 'selfhash263', 'unknown264', 'selfhash262'] as const

describe('exact reviewed Survey263 additive tail', () => {
  it('accepts actual SQL with an independent name and digest seal', () => {
    expect(SURVEY_WORKFLOW_REVIEWED_MIGRATION).toEqual({ name: '263_contextual_surveys_workflow.sql',
      sha256: '1db152f8c33d239bf18b9fc61bab6da8896f2d9c88fa0fdce12c8671c30770c9' })
    expect(Object.isFrozen(SURVEY_WORKFLOW_REVIEWED_MIGRATION)).toBe(true)
    expect(() => validateSurveyWorkflowReviewedMigration(current[262])).not.toThrow()
  })
  it.each(defects.filter(d => d !== 'unknown264' && d !== 'selfhash262'))('rejects independent leaf substitution %s', defect => {
    const migration = { ...current[262] }
    if (defect === 'name263') migration.name = '263_unknown.sql'
    if (defect === 'digest263') migration.sha256 = 'f'.repeat(64)
    if (defect === 'bytes263' || defect === 'selfhash263') migration.sql += '\n'
    if (defect === 'selfhash263') migration.sha256 = digest(migration.sql)
    expect(() => validateSurveyWorkflowReviewedMigration(migration)).toThrow()
  })
  for (const [name, make] of factories) {
    it(`preserves full current manifest and every prior migration for ${name}`, () => {
      const m = make(), expected = current.map(({ name, sha256 }) => ({ name, sha256 }))
      expect(m.migrations).toEqual(expected)
      expect(m.migrationManifestSha256).toBe(digest(JSON.stringify(expected)))
      expect(m.migrationManifestSha256).not.toBe(digest(JSON.stringify(expected.slice(0, 262))))
      expect(m.nativeVerified).toBe(false)
    })
    it.each(defects)(`${name} refuses altered complete tail %s`, defect => {
      const migrations = current.map(r => ({ ...r }))
      if (defect === 'name263') migrations[262].name = '263_unknown.sql'
      if (defect === 'digest263') migrations[262].sha256 = 'f'.repeat(64)
      if (defect === 'bytes263' || defect === 'selfhash263') migrations[262].sql += '\n'
      if (defect === 'selfhash263') migrations[262].sha256 = digest(migrations[262].sql)
      if (defect === 'selfhash262') { migrations[261].sql += '\n'; migrations[261].sha256 = digest(migrations[261].sql) }
      if (defect === 'unknown264') migrations.push({ name: '264_unknown.sql', sql: 'select 1;', sha256: digest('select 1;') })
      const load = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValueOnce(migrations)
      try { expect(make).toThrow() } finally { load.mockRestore() }
    })
  }
  for (const [name, validate] of [['member-list', validateTestMemberListReviewedMigrations], ['reorder', validateTestOwnerReorderReviewedMigrations]] as const) {
    it(`${name} accepts complete actual263 without slicing`, () => { expect(() => validate(current)).not.toThrow() })
    it.each(defects)(`${name} refuses altered complete tail %s`, defect => {
      const migrations = current.map(r => ({ ...r }))
      if (defect === 'name263') migrations[262].name = '263_unknown.sql'
      if (defect === 'digest263') migrations[262].sha256 = 'f'.repeat(64)
      if (defect === 'bytes263' || defect === 'selfhash263') migrations[262].sql += '\n'
      if (defect === 'selfhash263') migrations[262].sha256 = digest(migrations[262].sql)
      if (defect === 'selfhash262') { migrations[261].sql += '\n'; migrations[261].sha256 = digest(migrations[261].sql) }
      if (defect === 'unknown264') migrations.push({ name: '264_unknown.sql', sql: 'select 1;', sha256: digest('select 1;') })
      expect(() => validate(migrations)).toThrow()
    })
  }
})
