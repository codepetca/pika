import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateTestMemberListReviewedMigrations } from '../../scripts/check-contextual-test-member-list-lifecycle'
import { validateTestOwnerReorderReviewedMigrations } from '../../scripts/check-contextual-test-owner-reorder-lifecycle'
import { classroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'
import { validateDisposableBillingReplayMigrations, validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'

// Source admission only: this does not authorize migration or native proof execution.
describe('RepoLight 298–301 closed source profile', () => {
  const chain = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 301)
  const hash = (sql: string) => createHash('sha256').update(sql).digest('hex')

  it('accepts each exact extension and preserves the historical 297 profile', () => {
    expect(chain).toHaveLength(301)
    for (const count of [295, 296, 297, 298, 299, 300, 301]) {
      expect(() => validateLifecycleServicesReviewedMigrations(chain.slice(0, count))).not.toThrow()
    }
  })

  it.each([298, 299, 300, 301].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))(
    'rejects changed $number $defect', ({ number, defect }) => {
      const candidate = chain.map(m => ({ ...m }))
      const entry = candidate[number - 1]
      if (defect === 'name') entry.name = `${number}_unknown.sql`
      if (defect === 'digest') entry.sha256 = '0'.repeat(64)
      if (defect === 'bytes' || defect === 'self-hashed-bytes') entry.sql += '\n'
      if (defect === 'self-hashed-bytes') entry.sha256 = hash(entry.sql)
      expect(() => validateLifecycleServicesReviewedMigrations(candidate)).toThrow()
    },
  )

  it('fingerprints the exact new tables and the affected settings and account rows', () => {
    const before = classroomTestQuotaProofCatalog(['public.tests'], chain.slice(0, 297))
    const at298 = classroomTestQuotaProofCatalog(['public.tests'], chain.slice(0, 298))
    const at299 = classroomTestQuotaProofCatalog(['public.tests'], chain.slice(0, 299))
    const full = classroomTestQuotaProofCatalog(['public.tests'], chain)
    expect(at298).toEqual(before)
    expect(at299).toEqual([...before, 'private.repolight_managed_connections'].sort())
    for (const name of ['private.repolight_settings', 'private.repolight_managed_connections',
      'private.repolight_provision_control', 'private.repolight_provision_outbox',
      'private.stripe_billing_settings', 'public.account_plans', 'public.billing_account_access']) expect(full).toContain(name)
    const sql = 'select 1;'
    expect(() => classroomTestQuotaProofCatalog(['public.tests'], [...chain, {name:'302_unknown.sql',sql,sha256:hash(sql)}])).toThrow()
    for (const index of [297, 298, 299, 300]) {
      const changed = chain.map(entry => ({...entry})); changed[index].sql += '\n'; changed[index].sha256 = hash(changed[index].sql)
      expect(() => classroomTestQuotaProofCatalog(['public.tests'], changed)).toThrow()
    }
  })

  it('admits only complete sealed reorder and member-list tails', () => {
    expect(() => validateTestOwnerReorderReviewedMigrations(chain.slice(0, 297))).not.toThrow()
    expect(() => validateTestOwnerReorderReviewedMigrations(chain.slice(0, 298))).toThrow()
    expect(() => validateTestOwnerReorderReviewedMigrations(chain.slice(0, 299))).toThrow()
    expect(() => validateTestOwnerReorderReviewedMigrations(chain)).not.toThrow()
    for (const index of [297, 298, 299, 300]) {
      const changed = chain.map(entry => ({...entry})); changed[index].sql += '\n'; changed[index].sha256 = hash(changed[index].sql)
      expect(() => validateTestOwnerReorderReviewedMigrations(changed)).toThrow()
    }
    const sql = 'select 1;'
    expect(() => validateTestOwnerReorderReviewedMigrations([...chain, {name:'302_unknown.sql',sql,sha256:hash(sql)}])).toThrow()
    expect(() => validateTestMemberListReviewedMigrations(chain.slice(0, 298))).toThrow()
    expect(() => validateTestMemberListReviewedMigrations(chain.slice(0, 299))).toThrow()
    expect(() => validateTestMemberListReviewedMigrations(chain)).not.toThrow()
    for (const index of [297, 298, 299, 300]) {
      const changed = chain.map(entry => ({...entry})); changed[index].sql += '\n'; changed[index].sha256 = hash(changed[index].sql)
      expect(() => validateTestMemberListReviewedMigrations(changed)).toThrow()
    }
    expect(() => validateTestMemberListReviewedMigrations([...chain, {name:'302_unknown.sql',sql,sha256:hash(sql)}])).toThrow()
  })

  it('rejects missing, reordered and unknown tails', () => {
    expect(() => validateLifecycleServicesReviewedMigrations([...chain.slice(0, 297), chain[298]])).toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations([...chain.slice(0, 297), chain[298], chain[297]])).toThrow()
    const sql = 'select 1;'
    expect(() => validateLifecycleServicesReviewedMigrations([...chain, { name: '302_unknown.sql', sql, sha256: hash(sql) }])).toThrow()
  })
})

describe('Billing 302–329 disposable replay source profile', () => {
  const chain = loadAssignmentListReviewedMigrations(process.cwd())
  const hash = (sql: string) => createHash('sha256').update(sql).digest('hex')

  it('accepts the exact complete billing suffix for disposable replay only', () => {
    expect(chain).toHaveLength(329)
    expect(() => validateDisposableBillingReplayMigrations(chain)).not.toThrow()
    expect(() => validateDisposableBillingReplayMigrations(chain.slice(0, 301))).not.toThrow()
    for (const count of [303, 304, 307, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329]) expect(() => validateDisposableBillingReplayMigrations(chain.slice(0, count))).not.toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations(chain)).toThrow()
  })

  it.each([302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329])('rejects self-hashed changes to migration %i', version => {
    const changed = chain.map(migration => ({ ...migration }))
    changed[version - 1].sql += '\n-- source substitution'
    changed[version - 1].sha256 = hash(changed[version - 1].sql)
    expect(() => validateDisposableBillingReplayMigrations(changed)).toThrow()
  })

  it.each([305, 306, 307, 308, 309, 310, 311, 312, 313, 314, 315, 316, 317, 318, 319, 320, 321, 322, 323, 324, 325, 326, 327, 328, 329])('rejects renamed migration %i', version => {
    const changed = chain.map(migration => ({ ...migration }))
    changed[version - 1].name = `${version}_unreviewed.sql`
    expect(() => validateDisposableBillingReplayMigrations(changed)).toThrow()
  })

  it('rejects a partial suffix and a contiguous unknown successor', () => {
    for (const count of [302, 305, 306, 308, 309]) expect(() => validateDisposableBillingReplayMigrations(chain.slice(0, count))).toThrow()
    const sql = 'select 1;'
    expect(() => validateDisposableBillingReplayMigrations([...chain, { name: '330_unknown.sql', sql, sha256: hash(sql) }])).toThrow()
  })
})
