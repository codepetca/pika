import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { loadAssignmentListReviewedMigrations } from '../../scripts/contextual-assignment-list-proof-platform'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'
import { INDEPENDENT_CALENDAR_POST_DATES_REVIEWED_MIGRATION, validateIndependentCalendarPostDatesReviewedMigration } from '../../scripts/independent-calendar-post-dates-reviewed-migration'

// Offline exact-source admission only; SQL behavior has a disposable-clone proof.
describe('independent calendar post dates exact source profile', () => {
  const chain = loadAssignmentListReviewedMigrations(process.cwd()).slice(0, 295)
  it('admits only the exact295 extension and preserves reviewed historical profiles', () => {
    expect(chain).toHaveLength(295)
    expect(chain[294]).toMatchObject(INDEPENDENT_CALENDAR_POST_DATES_REVIEWED_MIGRATION)
    for (const count of [289,290,291,292,293,294,295]) {
      expect(() => validateLifecycleServicesReviewedMigrations(chain.slice(0,count))).not.toThrow()
    }
  })
  it('rejects renamed, rehashed, mismatched, and unknown migration tails', () => {
    const last = chain[294]
    const changed = last.sql + '\n'
    for (const entry of [{...last,name:'294_independent_calendar_post_dates.sql'}, {...last,name:'295_other.sql'}, {...last,sha256:'0'.repeat(64)},
      {...last,sql:changed}, {...last,sql:changed,sha256:createHash('sha256').update(changed).digest('hex')}]) {
      expect(() => validateIndependentCalendarPostDatesReviewedMigration(entry)).toThrow()
    }
    expect(() => validateLifecycleServicesReviewedMigrations([...chain,{name:'296_unknown.sql',sql:'select 1;',sha256:createHash('sha256').update('select 1;').digest('hex')}])).toThrow()
  })
  it('keeps historical294 admission-only and refuses the former calendar294 alias', () => {
    const formerCalendar = {...chain[294],name:'294_independent_calendar_post_dates.sql'}
    expect(() => validateLifecycleServicesReviewedMigrations([...chain.slice(0,293),formerCalendar])).toThrow()
    const substitutedAdmission = {...chain[294],name:chain[293].name}
    expect(() => validateLifecycleServicesReviewedMigrations([...chain.slice(0,293),substitutedAdmission])).toThrow()
  })
})
