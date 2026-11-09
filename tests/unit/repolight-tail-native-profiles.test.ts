import { createHash } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import * as platform from '../../scripts/contextual-assignment-list-proof-platform'
import { newAssignmentListProofFixture } from '../../scripts/contextual-assignment-list-proof-fixture'
import { classroomTestQuotaProofCatalog, disposableClassroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'
import { classroomHotLifecycleNativePlan } from '../../scripts/contextual-classroom-hot-lifecycle-native-contracts'
import { testMemberListReviewedIsolatedCatalog, validateTestMemberListReviewedMigrations } from '../../scripts/check-contextual-test-member-list-lifecycle'
import { TEST_MEMBER_LIST_CANONICAL_TABLES_248 } from '../../scripts/contextual-test-member-list-proof-fixture'
import { createOfflineTestLearnerRepository } from '../helpers/test-learner-native-repository'

const repository = process.cwd()
const current = platform.loadAssignmentListReviewedMigrations(repository)
const chain = current.slice(0, 301)
const hash = (sql: string) => createHash('sha256').update(sql).digest('hex')
const original = newAssignmentListProofFixture(new Date('2026-10-07T03:00:00Z'))

describe('sealed 300 native source profiles (offline only)', () => {
  it('adds the complete target catalog from each exact reviewed canonical prefix', () => {
    const target = classroomTestQuotaProofCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, chain)
    for (const count of [294, 295, 296, 297, 298, 299, 300, 301]) {
      const source = classroomTestQuotaProofCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, chain.slice(0, count))
      expect(testMemberListReviewedIsolatedCatalog(source, chain)).toEqual(target)
    }
    const missing = target.filter(table => table !== 'private.repolight_provision_control')
    expect(() => testMemberListReviewedIsolatedCatalog(missing, chain)).toThrow()
    expect(() => validateTestMemberListReviewedMigrations(chain)).not.toThrow()
  })

  it('constructs hot lifecycle with a dormant setup guard and whole-schema witness', () => {
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(chain)
    try {
      const plan = classroomHotLifecycleNativePlan(original, 'a'.repeat(40), repository)
      expect(plan.migrations).toHaveLength(301)
      expect(plan.nativeVerified).toBe(false)
      for (const value of ['not managed_provisioning_enabled', 'private.repolight_provision_control',
        'epoch=1', 'private.repolight_provision_outbox', 'private.repolight_managed_connections']) expect(plan.setup).toContain(value)
      expect(plan.snapshot).toContain("n.nspname in ('public','private','storage')")
      expect(plan.snapshot).toContain('pg_get_functiondef(p.oid)')
      expect(plan.snapshot).toContain('pg_get_triggerdef(trigger_row.oid)')
    } finally { loader.mockRestore() }
  })

  it('keeps the complete billing replay tail out of the historical native plan and catalog', () => {
    expect(() => classroomHotLifecycleNativePlan(original, 'a'.repeat(40), repository)).toThrow()
    expect(() => classroomTestQuotaProofCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, current)).toThrow()
  })

  it('admits the sealed billing suffix for member-list disposable replay and fingerprints its new table', () => {
    expect(() => validateTestMemberListReviewedMigrations(current)).not.toThrow()
    expect(() => validateTestMemberListReviewedMigrations(current.slice(0, 303))).not.toThrow()
    const catalog301 = classroomTestQuotaProofCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, chain)
    expect(testMemberListReviewedIsolatedCatalog(catalog301, current)).toEqual([...catalog301, 'private.billing_scheduled_plan_changes', 'private.billing_classroom_restrictions', 'private.billing_assignment_release_intents'].sort())
    expect(testMemberListReviewedIsolatedCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, current)).toEqual([...catalog301, 'private.billing_scheduled_plan_changes', 'private.billing_classroom_restrictions', 'private.billing_assignment_release_intents'].sort())
    const catalog307 = disposableClassroomTestQuotaProofCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, current.slice(0, 307))
    expect(catalog307).toEqual([...catalog301, 'private.billing_scheduled_plan_changes'].sort())
    expect(testMemberListReviewedIsolatedCatalog(catalog307, current)).toEqual([...catalog307, 'private.billing_classroom_restrictions', 'private.billing_assignment_release_intents'].sort())
    for (const count of [310, 311]) {
      const prefix = disposableClassroomTestQuotaProofCatalog(TEST_MEMBER_LIST_CANONICAL_TABLES_248, current.slice(0, count))
      expect(prefix).toContain('private.billing_classroom_restrictions')
      expect(prefix).not.toContain('private.billing_assignment_release_intents')
      expect(testMemberListReviewedIsolatedCatalog(prefix, current)).toContain('private.billing_assignment_release_intents')
    }
    for (const count of [308, 309]) {
      expect(() => testMemberListReviewedIsolatedCatalog(catalog307, current.slice(0, count))).toThrow()
    }
    expect(() => testMemberListReviewedIsolatedCatalog([...catalog307, 'private.unreviewed'], current)).toThrow()
    const changed307 = current.map(row => ({ ...row }))
    changed307[306].sql += '\n-- changed source'
    changed307[306].sha256 = hash(changed307[306].sql)
    expect(() => testMemberListReviewedIsolatedCatalog(catalog307, changed307)).toThrow()
    const changed = current.map(row => ({ ...row }))
    changed[303].sql += '\n'
    changed[303].sha256 = hash(changed[303].sql)
    for (const inventory of [changed, current.slice(0, 302)]) {
      expect(() => validateTestMemberListReviewedMigrations(inventory)).toThrow()
      expect(() => testMemberListReviewedIsolatedCatalog(catalog301, inventory)).toThrow()
    }
  }, 30_000)

  it('copies only the historical learner prefix after validating the full current chain', () => {
    const offline = createOfflineTestLearnerRepository(repository, 258)
    try {
      const names = readdirSync(`${offline.repository}/supabase/migrations`).sort()
      expect(names).toHaveLength(258)
      expect(names.at(-1)).toBe('258_student_test_session_status_projection.sql')
    } finally { offline.dispose() }
    expect(existsSync(offline.repository)).toBe(false)
  })

  it.each([297, 298, 299, 300])('rejects self-hashed changed tail at index %i before prefix copying or hot plan', index => {
    const changed = chain.map(row => ({...row})); changed[index].sql += '\n'; changed[index].sha256 = hash(changed[index].sql)
    const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(changed)
    try {
      expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
      expect(() => classroomHotLifecycleNativePlan(original, 'a'.repeat(40), repository)).toThrow()
      expect(() => validateTestMemberListReviewedMigrations(changed)).toThrow()
    } finally { loader.mockRestore() }
  })

  it('rejects partial and unknown source tails', () => {
    for (const inventory of [chain.slice(0, 298), chain.slice(0, 299), [...chain, {name:'302_unknown.sql',sql:'select 1;',sha256:hash('select 1;')}],
      [...current, {name:'308_unknown.sql',sql:'select 1;',sha256:hash('select 1;')}]]) {
      const loader = vi.spyOn(platform, 'loadAssignmentListReviewedMigrations').mockReturnValue(inventory)
      try {
        expect(() => createOfflineTestLearnerRepository(repository)).toThrow()
        expect(() => classroomHotLifecycleNativePlan(original, 'a'.repeat(40), repository)).toThrow()
        expect(() => validateTestMemberListReviewedMigrations(inventory)).toThrow()
      } finally { loader.mockRestore() }
    }
  })
})
