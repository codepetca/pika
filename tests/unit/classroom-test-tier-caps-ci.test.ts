import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')

describe('classroom Test caps database CI contract', () => {
  it('runs the rollback behavior fixture in the migrated ephemeral CI database', () => {
    const workflow = read('.github/workflows/ci.yml')
    const database = workflow.split('  architecture-database-contracts:\n')[1]?.split(/\n  [a-z][a-z-]*:\n/)[0]
    const command = 'bash scripts/check-classroom-test-tier-caps-database.sh'
    expect(workflow.split(command)).toHaveLength(2)
    expect(database).toContain(command)
    expect(database).toContain('name: Start ephemeral Supabase and replay migrations')
    expect(database).toContain('name: Stop ephemeral database')
    expect(database!.indexOf('name: Start ephemeral Supabase and replay migrations')).toBeLessThan(database!.indexOf(command))
    expect(database!.indexOf(command)).toBeLessThan(database!.indexOf('name: Stop ephemeral database'))
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
