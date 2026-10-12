import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEST_OWNER_DELETION_REVIEWED_MIGRATION, validateTestOwnerDeletionReviewedMigration } from '../../scripts/test-owner-deletion-reviewed-migration'

const digest = (sql: string) => createHash('sha256').update(sql).digest('hex')
describe('externally sealed dormant Test deletion migration', () => {
  it('accepts only the exact frozen262 name, bytes and digest', () => {
    const name = TEST_OWNER_DELETION_REVIEWED_MIGRATION.name
    const sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
    expect(name).toBe('262_contextual_test_owner_delete.sql')
    expect(() => validateTestOwnerDeletionReviewedMigration({ name, sql, sha256: digest(sql) })).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'selfhash'])('rejects changed %s', defect => {
    const name = TEST_OWNER_DELETION_REVIEWED_MIGRATION.name
    const sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
    const candidate = { name, sql, sha256: digest(sql) }
    if (defect === 'name') candidate.name = '263_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'selfhash') candidate.sql += '\n'
    if (defect === 'selfhash') candidate.sha256 = digest(candidate.sql)
    expect(() => validateTestOwnerDeletionReviewedMigration(candidate)).toThrow()
  })
})
