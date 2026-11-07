import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { classroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'
import { classroomHotLifecycleNativePlan } from '../../scripts/contextual-classroom-hot-lifecycle-native-contracts'
import { testMemberListReviewedIsolatedCatalog, validateTestMemberListReviewedMigrations } from '../../scripts/check-contextual-test-member-list-lifecycle'
import { TEST_MEMBER_LIST_CANONICAL_TABLES_248 } from '../../scripts/contextual-test-member-list-proof-fixture'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'

const repository = process.cwd()
const chain = platform.loadAssignmentListReviewedMigrations(repository)
const hash = (sql: string) => createHash('sha256').update(sql).digest('hex')
const original = newAssignmentListProofFixture(new Date('2026-10-07T03:00:00Z'))

describe('sealed 300 native source profiles (offline only)', () => {
  it('adds the complete target catalog from each exact reviewed canonical prefix', () => {
    const target = classroomTestQuotaProofCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, chain)
    for (const count of [294, 295, 296, 297, 298, 299, 300]) {
      const source = classroomTestQuotaProofCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, chain.slice(0, count))
      expect(testMemberListReviewedIsolatedCatalog(source, chain)).toEqual(target)
    }
    const missing = target.filter(table => table !== 'private.repolight_provision_control')
    expect(() => testMemberListReviewedIsolatedCatalog(missing, chain)).toThrow()
    expect(() => validateTestMemberListReviewedMigrations(chain)).not.toThrow()
  })

  it('constructs hot lifecycle with a dormant setup guard and whole-schema witness', () => {
    const plan = classroomHotLifecycleNativePlan(original, 'a'.repeat(40), repository)
    expect(plan.migrations).toHaveLength(300)
    expect(plan.nativeVerified).toBe(false)
    for (const value of ['not managed_provisioning_enabled', 'private.repolight_provision_control',
      'epoch=1', 'private.repolight_provision_outbox', 'private.repolight_managed_connections']) expect(plan.setup).toContain(value)
    expect(plan.snapshot).toContain("n.nspname in ('public','private','storage')")
    expect(plan.snapshot).toContain('pg_get_functiondef(p.oid)')
    expect(plan.snapshot).toContain('pg_get_triggerdef(trigger_row.oid)')
  })

  it('copies only the historical learner prefix after validating the full current chain', () => {
    const offline = createOfflineTestLearnerRepository(repository, 258)
    try {
      const names = readdirSync(`${offline.repository}/supabase/migrations`).sort()
      expect(names).toHaveLength(258)
      expect(names.at(-1)).toBe('258_student_test_session_status_projection.sql')
    } finally { offline.dispose() }
    expect(existsSync(offline.repository)).toBe(false)
  })

  it.each([297, 298, 299])('rejects self-hashed changed tail at index %i before prefix copying or hot plan', index => {
    const changed = chain.map(row => ({...row})); changed[index].sql += '\n'; changed[index].sha256 = hash(changed[index].sql)
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(changed)
    try {
      expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
      expect(() => classroomHotLifecycleNativePlan(original, 'a'.repeat(40), repository)).toThrow()
      expect(() => validateTestMemberListReviewedMigrations(changed)).toThrow()
    } finally { loader.mockRestore() }
  })

  it('rejects partial and unknown source tails', () => {
    for (const inventory of [chain.slice(0, 298), chain.slice(0, 299), [...chain, {name:'301_unknown.sql',sql:'select 1;',sha256:hash('select 1;')} ]]) {
      const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(inventory)
      try {
        expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
        expect(() => classroomHotLifecycleNativePlan(original, 'a'.repeat(40), repository)).toThrow()
        expect(() => validateTestMemberListReviewedMigrations(inventory)).toThrow()
      } finally { loader.mockRestore() }
    }
  })
})
