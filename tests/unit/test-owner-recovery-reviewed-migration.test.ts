import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEST_OWNER_RECOVERY_REVIEWED_MIGRATION, validateTestOwnerRecoveryReviewedMigration } from '../../scripts/test-owner-recovery-reviewed-migration'

describe('recovery candidate source seal grants no execution authority', () => {
  it('binds the exact frozen migration bytes without granting native acceptance', () => {
    const name = TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.name
    const sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
    expect(() => validateTestOwnerRecoveryReviewedMigration({ name, sql, sha256: createHash('sha256').update(sql).digest('hex') })).not.toThrow()
  })
  it('is fixed and refuses arbitrary self-hashed source including while awaiting root freeze', () => {
    expect(Object.isFrozen(TEST_OWNER_RECOVERY_REVIEWED_MIGRATION)).toBe(true)
    const sql = '-- unreviewed260\n'
    expect(() => validateTestOwnerRecoveryReviewedMigration({ name: TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.name,
      sql, sha256: createHash('sha256').update(sql).digest('hex') })).toThrow()
  })
  it.each(['name', 'digest', 'bytes'])('refuses altered %s', defect => {
    const candidate = { name: TEST_OWNER_RECOVERY_REVIEWED_MIGRATION.name, sql: 'select 1;', sha256: 'f'.repeat(64) }
    if (defect === 'name') candidate.name = '260_unknown.sql'
    if (defect === 'digest') candidate.sha256 = '0'.repeat(64)
    if (defect === 'bytes') candidate.sql += '\n'
    expect(() => validateTestOwnerRecoveryReviewedMigration(candidate)).toThrow()
  })
})
