import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractWorkflow, selectPlan } from '../../scripts/run-ci-local.mjs'

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
    const jobs = extractWorkflow(workflow), command = 'bash scripts/check-contextual-attendance-policy-database.sh'
    for (const lane of ['database', 'all']) {
      const selected = selectPlan(jobs, lane).flatMap(job => job.steps.filter(step => step.run === command).map(step => ({ job, step })))
      expect(selected).toHaveLength(1)
      expect(selected[0].job.id).toBe('architecture-database-contracts')
      const steps = selected[0].job.steps, at = steps.indexOf(selected[0].step)
      expect(steps[at - 1].run).toBe('pnpm run check:bara-attendance-db')
      expect(steps[at + 1].run).toBe('bash scripts/check-pal-outbox-concurrency.sh')
    }
  })

  it('keeps the exact component verdict free of void SELECT output', () => {
    const suite = readFileSync('scripts/check-contextual-attendance-policy.sql', 'utf8')
    expect(suite).not.toMatch(/^select pg_temp\.expect_attendance_policy\(/m)
    expect(suite).toContain('do $expect$ begin perform pg_temp.expect_attendance_policy(')
  })
})
