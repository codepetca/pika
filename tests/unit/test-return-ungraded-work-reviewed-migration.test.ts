import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { TEST_RETURN_UNGRADED_WORK_REVIEWED_MIGRATION, validateTestReturnUngradedWorkReviewedMigration } from '../../scripts/test-return-ungraded-work-reviewed-migration'

const sql = readFileSync('supabase/migrations/265_test_return_ungraded_work.sql', 'utf8')
const evidence = { ...TEST_RETURN_UNGRADED_WORK_REVIEWED_MIGRATION, sql }
describe('fixed Test return ungraded-work migration seal', () => {
  it('accepts the exact reviewed filename, stored hash and raw SQL bytes', () => {
    expect(() => validateTestReturnUngradedWorkReviewedMigration(evidence)).not.toThrow()
  })
  it.each(['name', 'digest', 'bytes', 'self-hashed-bytes'])('refuses altered %s', defect => {
    const candidate = { ...evidence }
    if (defect === 'name') candidate.name = '265_unknown.sql'
    if (defect === 'digest') candidate.sha256 = 'f'.repeat(64)
    if (defect === 'bytes' || defect === 'self-hashed-bytes') candidate.sql += '\n'
    if (defect === 'self-hashed-bytes') candidate.sha256 = createHash('sha256').update(candidate.sql).digest('hex')
    expect(() => validateTestReturnUngradedWorkReviewedMigration(candidate)).toThrow()
  })
})
