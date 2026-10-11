import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TEST_OWNER_GRADING_REVIEWED_MIGRATION, validateTestOwnerGradingReviewedMigration } from '../../scripts/test-owner-grading-reviewed-migration'

const digest = (sql: string) => createHash('sha256').update(sql).digest('hex')
const sql = readFileSync('supabase/migrations/258_contextual_test_owner_grading.sql', 'utf8')
const candidate = { name: '258_contextual_test_owner_grading.sql', sql, sha256: digest(sql) }

describe('exact owner grading migration source seal, not execution authority', () => {
  it('accepts only the fixed candidate name, digest and bytes', () => {
    expect(candidate).toMatchObject(TEST_OWNER_GRADING_REVIEWED_MIGRATION)
    expect(() => validateTestOwnerGradingReviewedMigration(candidate)).not.toThrow()
    expect(Object.isFrozen(TEST_OWNER_GRADING_REVIEWED_MIGRATION)).toBe(true)
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'] as const)('rejects altered %s', defect => {
    const modified = { ...candidate }
    if (defect === 'name') modified.name = '258_unknown.sql'
    if (defect === 'digest') modified.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') modified.sql += '\n'
    if (defect === 'self-hashed-bytes') modified.sha256 = digest(modified.sql)
    expect(() => validateTestOwnerGradingReviewedMigration(modified)).toThrow()
  })
})
