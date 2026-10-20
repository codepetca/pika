import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('attendance owner policy database CI contract', () => {
  it('binds the rollback suite to the existing local project and database port', () => {
    const script = readFileSync('scripts/check-contextual-attendance-policy-database.sh', 'utf8')
    expect(script).toContain("attendance_policy_container='supabase_db_pika'")
    expect(script).toContain('com.supabase.cli.project')
    expect(script).toContain(':54322[[:space:]]*$')
    expect(script).toContain('check-contextual-attendance-policy.sql')
    expect(script).toContain('ON_ERROR_STOP=1')
    expect(script).toContain('VERBOSITY=sqlstate')
    expect(script).not.toMatch(/--linked|DATABASE_URL|SERVICE_ROLE|db push|db reset|eval /)
  })

  it('runs the rollback suite in the existing ephemeral database lane', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    expect(workflow).toContain('run: bash scripts/check-contextual-attendance-policy-database.sh')
  })

  it('keeps the exact component verdict free of void SELECT output', () => {
    const suite = readFileSync('scripts/check-contextual-attendance-policy.sql', 'utf8')
    expect(suite).not.toMatch(/^select pg_temp\.expect_attendance_policy\(/m)
    expect(suite).toContain('do $expect$ begin perform pg_temp.expect_attendance_policy(')
  })
})
