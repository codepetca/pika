import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateTestMemberListReviewedMigrations } from '../../scripts/check-contextual-test-member-list-lifecycle'
import { validateTestOwnerReorderReviewedMigrations } from '../../scripts/check-contextual-test-owner-reorder-lifecycle'
import { classroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'

// Source admission only: this does not authorize migration or native proof execution.
describe('RepoLight 296–298 closed source profile', () => {
  const chain = loadAssignmentListReviewedMigrations(process.cwd())
  const hash = (sql: string) => createHash('sha256').update(sql).digest('hex')

  it('accepts each exact extension and preserves the historical 295 profile', () => {
    expect(chain).toHaveLength(298)
    for (const count of [295, 296, 297, 298]) {
      expect(() => validateLifecycleServicesReviewedMigrations(chain.slice(0, count))).not.toThrow()
    }
  })

  it.each([296, 297, 298].flatMap(number => ['name', 'digest', 'bytes', 'self-hashed-bytes'].map(defect => ({ number, defect }))))(
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

  it('does not expand native preservation catalog authority', () => {
    expect(() => classroomTestQuotaProofCatalog(['public.tests'], chain.slice(0, 295))).not.toThrow()
    expect(() => classroomTestQuotaProofCatalog(['public.tests'], chain.slice(0, 296))).toThrow('Unreviewed quota proof catalog')
    expect(() => classroomTestQuotaProofCatalog(['public.tests'], chain.slice(0, 297))).toThrow('Unreviewed quota proof catalog')
    expect(() => classroomTestQuotaProofCatalog(['public.tests'], chain)).toThrow('Unreviewed quota proof catalog')
  })

  it('keeps native member and reorder profiles closed to the actual inventory', () => {
    for (const validate of [validateTestMemberListReviewedMigrations, validateTestOwnerReorderReviewedMigrations]) {
      expect(() => validate(chain.slice(0, 295))).not.toThrow()
      expect(() => validate(chain.slice(0, 296))).toThrow()
      expect(() => validate(chain.slice(0, 297))).toThrow()
      expect(() => validate(chain)).toThrow()
    }
  })

  it('rejects missing, reordered and unknown tails', () => {
    expect(() => validateLifecycleServicesReviewedMigrations([...chain.slice(0, 295), chain[296]])).toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations([...chain.slice(0, 295), chain[296], chain[295]])).toThrow()
    const sql = 'select 1;'
    expect(() => validateLifecycleServicesReviewedMigrations([...chain, { name: '299_unknown.sql', sql, sha256: hash(sql) }])).toThrow()
  })
})
