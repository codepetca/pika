import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CLASSROOM_ADMISSION_REGISTRY_REVIEWED_MIGRATION, CLASSROOM_ADMISSION_REGISTRY_REVIEWED_TABLES,
  validateClassroomAdmissionRegistryReviewedMigration } from '../../scripts/classroom-admission-registry-reviewed-migration'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'

const current = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 295)
const sha256 = (sql: string) => createHash('sha256').update(sql).digest('hex')

describe('inactive classroom admission294 exact reviewed source profile', () => {
  it('seals the final source and four literal whole-row catalog tables', () => {
    expect(current).toHaveLength(295)
    expect(current[293]).toMatchObject(CLASSROOM_ADMISSION_REGISTRY_REVIEWED_MIGRATION)
    expect(sha256(current[293].sql)).toBe(CLASSROOM_ADMISSION_REGISTRY_REVIEWED_MIGRATION.sha256)
    expect([...current[293].sql.matchAll(/^create table (private\.[a-z_]+)/gm)].map(match => match[1]).sort())
      .toEqual([...CLASSROOM_ADMISSION_REGISTRY_REVIEWED_TABLES].sort())
    expect(() => validateClassroomAdmissionRegistryReviewedMigration(current[293])).not.toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations(current)).not.toThrow()
    for (const count of [291,292,293,294]) expect(() => validateLifecycleServicesReviewedMigrations(current.slice(0,count))).not.toThrow()
  })
  it.each(['missing','name','digest','bytes','self-hashed-bytes'])('rejects %s294 source evidence', defect => {
    const candidate = { ...current[293] }
    if (defect === 'missing') {
      expect(() => validateClassroomAdmissionRegistryReviewedMigration(undefined as never)).toThrow('absent')
      return
    }
    if (defect === 'name') candidate.name = '294_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = sha256(candidate.sql)
    expect(() => validateClassroomAdmissionRegistryReviewedMigration(candidate)).toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations([...current.slice(0,293),candidate])).toThrow()
  })
  it('rejects an unknown contiguous296 extension without widening the closed profile', () => {
    const sql = 'select 1;'
    expect(() => validateLifecycleServicesReviewedMigrations([...current,{name:'296_unknown.sql',sql,sha256:sha256(sql)}])).toThrow()
  })
})
