import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('classroom Test caps database CI contract', () => {
  it('runs the rollback behavior fixture in the migrated ephemeral CI database', () => {
    expect(read('.github/workflows/ci.yml').includes('bash scripts/check-classroom-test-tier-caps-database.sh')).toBe(true)
  })
  it('requires an already migrated exact local target and never applies SQL schema', () => {
    const wrapper = read('scripts/check-classroom-test-tier-caps-database.sh')
    expect(wrapper).toContain('com.supabase.cli.project')
    expect(wrapper).toContain(':54322$')
    expect(wrapper).toContain("version = '253'")
    expect(wrapper).toContain('check-classroom-test-tier-caps-database.sql')
    expect(wrapper).not.toMatch(/db push|db reset|--linked|apply_migration/)
  })
})
