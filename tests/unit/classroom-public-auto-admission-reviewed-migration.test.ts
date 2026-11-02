import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'
import { classroomTestQuotaProofCatalog } from '../../scripts/classroom-test-quota-proof-catalog'
import { CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_MIGRATION, CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_TABLES,
  validateClassroomPublicAutoAdmissionReviewedMigration } from '../../scripts/classroom-public-auto-admission-reviewed-migration'

// Source profile and catalog only: this does not claim 297 native database proof.
const chain = loadAssignmentListReviewedMigrations(process.cwd())
const digest = (sql: string) => createHash('sha256').update(sql).digest('hex')

describe('public auto-admission exact source profile', () => {
  it('seals the exact 297 extension and preserves the 296 historical catalog', () => {
    expect(chain).toHaveLength(297)
    expect(chain[296]).toMatchObject(CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_MIGRATION)
    expect(() => validateLifecycleServicesReviewedMigrations(chain.slice(0, 296))).not.toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations(chain)).not.toThrow()
    expect([...chain[296].sql.matchAll(/^create table ((?:public|private)\.[a-z_]+)/gm)].map(match => match[1]))
      .toEqual([...CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_TABLES])
    const oldCatalog = classroomTestQuotaProofCatalog(['public.tests'], chain.slice(0, 296))
    const newCatalog = classroomTestQuotaProofCatalog(['public.tests'], chain)
    expect(newCatalog).toEqual([...oldCatalog, ...CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_TABLES].sort())
    expect(oldCatalog).not.toContain(CLASSROOM_PUBLIC_AUTO_ADMISSION_REVIEWED_TABLES[0])
  })
  it.each(['missing', 'name', 'digest', 'bytes', 'self-hashed-bytes'])('refuses %s source', defect => {
    const candidate = { ...chain[296] }
    if (defect === 'missing') {
      expect(() => validateClassroomPublicAutoAdmissionReviewedMigration(undefined as never)).toThrow('absent')
      expect(() => classroomTestQuotaProofCatalog(['public.tests'], [...chain.slice(0, 296), { ...candidate, name: '297_missing.sql' }])).toThrow()
      return
    }
    if (defect === 'name') candidate.name = '297_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = digest(candidate.sql)
    expect(() => validateClassroomPublicAutoAdmissionReviewedMigration(candidate)).toThrow()
    const changed = [...chain.slice(0, 296), candidate]
    expect(() => validateLifecycleServicesReviewedMigrations(changed)).toThrow()
    expect(() => classroomTestQuotaProofCatalog(['public.tests'], changed)).toThrow()
  })
  it('rejects an unknown contiguous 298 tail', () => {
    const sql = 'select 1;'
    const extended = [...chain, { name: '298_unknown.sql', sql, sha256: digest(sql) }]
    expect(() => validateLifecycleServicesReviewedMigrations(extended)).toThrow()
    expect(() => classroomTestQuotaProofCatalog(['public.tests'], extended)).toThrow()
  })
})
