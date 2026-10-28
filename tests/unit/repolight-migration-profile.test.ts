import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateLifecycleServicesReviewedMigrations } from '../../scripts/lifecycle-services-reviewed-migrations'
import { validateRepoLightReportServiceReviewedMigration } from '../../scripts/repolight-report-service-reviewed-migration'

describe('RepoLight exact source profile (not native execution authority)', () => {
  const migrations = () => readdirSync('supabase/migrations').filter(name => /^\d{3}_.*\.sql$/.test(name)).sort().map(name => {
    const sql = readFileSync(`supabase/migrations/${name}`, 'utf8')
    return { name, sql, sha256: createHash('sha256').update(sql).digest('hex') }
  })
  it('accepts the full sealed293 chain and preserves historical seals', () => {
    expect(() => validateLifecycleServicesReviewedMigrations(migrations().slice(0,293))).not.toThrow()
    expect(() => validateLifecycleServicesReviewedMigrations(migrations().slice(0,292))).not.toThrow()
  })
  it('rejects any migration/source/hash substitution and unknown next profile', () => {
    const chain=migrations(), last=chain[292]
    expect(() => validateRepoLightReportServiceReviewedMigration({...last,sql:last.sql+'\n'})).toThrow()
    expect(() => validateRepoLightReportServiceReviewedMigration({...last,sha256:'0'.repeat(64)})).toThrow()
    expect(() => validateRepoLightReportServiceReviewedMigration({...last,name:'294_other.sql'})).toThrow()
    const next={name:'295_other.sql',sql:'select 1;',sha256:createHash('sha256').update('select 1;').digest('hex')}
    expect(() => validateLifecycleServicesReviewedMigrations([...chain,next])).toThrow('Unreviewed')
  })
})
