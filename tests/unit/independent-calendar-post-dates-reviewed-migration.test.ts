import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'
import { INDEPENDENT_CALENDAR_POST_DATES_REVIEWED_MIGRATION, validateIndependentCalendarPostDatesReviewedMigration } from '../../scripts/independent-calendar-post-dates-reviewed-migration'

// Offline exact-source admission only; SQL behavior has a disposable-clone proof.
describe('independent calendar post dates exact source profile', () => {
  const chain = loadAssignmentListReviewedMigrations(process.cwd())
  it('admits only the exact294 extension and preserves reviewed historical profiles', () => {
    expect(chain).toHaveLength(294)
    expect(chain[293]).toMatchObject(INDEPENDENT_CALENDAR_POST_DATES_REVIEWED_MIGRATION)
    for (const count of [289,290,291,292,293,294]) {
      expect(() => validateLifecycleServicesReviewedMigrations(chain.slice(0,count))).not.toThrow()
    }
  })
  it('rejects renamed, rehashed, mismatched, and unknown migration tails', () => {
    const last = chain[293]
    const changed = last.sql + '\n'
    for (const entry of [{...last,name:'294_other.sql'}, {...last,sha256:'0'.repeat(64)},
      {...last,sql:changed}, {...last,sql:changed,sha256:createHash('sha256').update(changed).digest('hex')}]) {
      expect(() => validateIndependentCalendarPostDatesReviewedMigration(entry)).toThrow()
    }
    expect(() => validateLifecycleServicesReviewedMigrations([...chain,{name:'295_unknown.sql',sql:'select 1;',sha256:createHash('sha256').update('select 1;').digest('hex')}])).toThrow('Unreviewed')
  })
})
