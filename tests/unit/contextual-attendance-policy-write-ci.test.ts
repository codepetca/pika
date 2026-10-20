import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractWorkflow, selectPlan } from '../../scripts/run-ci-local.mjs'

describe('attendance owner policy write database CI contract', () => {
  it('retains exact project/port and rollback script binding without an alternate target', () => {
    const script = readFileSync('scripts/check-contextual-attendance-policy-write-database.sh', 'utf8')
    expect(script).toContain("attendance_policy_write_container='supabase_db_pika'")
    expect(script).toContain('com.supabase.cli.project')
    expect(script).toContain(':54322[[:space:]]*$')
    expect(script).toContain('check-contextual-attendance-policy-write.sql')
    expect(script).toContain('ON_ERROR_STOP=1')
    expect(script).toContain('VERBOSITY=sqlstate')
    expect(script).not.toMatch(/--linked|DATABASE_URL|SERVICE_ROLE|db push|db reset|eval /)
  })

  it('runs the owner-write proof exactly once in the existing primary lane', () => {
    const jobs = extractWorkflow(readFileSync('.github/workflows/ci.yml', 'utf8'))
    const command = 'bash scripts/check-contextual-attendance-policy-write-database.sh'
    for (const lane of ['database', 'all']) {
      const selected = selectPlan(jobs, lane).flatMap(job => job.steps.filter(step => step.run === command).map(step => ({ job, step })))
      expect(selected).toHaveLength(1)
      expect(selected[0].job.id).toBe('architecture-database-contracts')
      const at = selected[0].job.steps.indexOf(selected[0].step)
      expect(selected[0].job.steps[at - 1].run).toBe('bash scripts/check-pal-outbox-concurrency.sh')
      expect(selected[0].job.steps[at + 1].run).toBe('pnpm run smoke:pal-delivery-recovery')
    }
  })
})
