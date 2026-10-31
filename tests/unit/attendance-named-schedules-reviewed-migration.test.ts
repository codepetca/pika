import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'
import { ATTENDANCE_NAMED_SCHEDULES_REVIEWED_MIGRATION, validateAttendanceNamedSchedulesReviewedMigration } from '../../scripts/attendance-named-schedules-reviewed-migration'

const digest = (sql: string) => createHash('sha256').update(sql).digest('hex')
const chain = loadAssignmentListReviewedMigrations(process.cwd())

describe('attendance named schedules source-only profile', () => {
  it('admits exact 296 and preserves the reviewed 295 prefix', () => {
    expect(chain).toHaveLength(296)
    expect(chain[295]).toMatchObject(ATTENDANCE_NAMED_SCHEDULES_REVIEWED_MIGRATION)
    expect(() => validateAttendanceNamedSchedulesReviewedMigration(chain[295])).not.toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations(chain.slice(0, 295))).not.toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations(chain)).not.toThrow()
  })
  it.each(['missing', 'name', 'digest', 'bytes', 'self-hashed-bytes'])('rejects %s source evidence', defect => {
    const candidate = { ...chain[295] }
    if (defect === 'missing') {
      expect(() => validateAttendanceNamedSchedulesReviewedMigration(undefined as never)).toThrow('absent')
      return
    }
    if (defect === 'name') candidate.name = '296_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = digest(candidate.sql)
    expect(() => validateAttendanceNamedSchedulesReviewedMigration(candidate)).toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations([...chain.slice(0, 295), candidate])).toThrow()
  })
  it('rejects a contiguous unknown 297 tail', () => {
    const sql = 'select 1;'
    expect(() => validateLifecycleServicesReviewedMigrations([...chain, { name: '297_unknown.sql', sql, sha256: digest(sql) }])).toThrow('Unreviewed')
  })
})
