import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractWorkflow, selectPlan } from '../../scripts/run-ci-local.mjs'

describe('contextual owner classroom list reorder CI contract', () => {
  it('retains the exact project, port and rollback-only SQL target', () => {
    const script = readFileSync('scripts/check-contextual-classroom-list-reorder-database.sh', 'utf8')
    expect(script).toContain("classroom_list_reorder_container='supabase_db_pika'")
    expect(script).toContain('com.supabase.cli.project')
    expect(script).toContain(':54322[[:space:]]*$')
    expect(script).toContain('check-contextual-classroom-list-reorder.sql')
    expect(script).toContain('ON_ERROR_STOP=1')
    expect(script).toContain('VERBOSITY=sqlstate')
    expect(script).not.toMatch(/--linked|DATABASE_URL|SERVICE_ROLE|db push|db reset|eval /)
  })
  it('selects one literal reorder proof in the primary database lane', () => {
    const jobs = extractWorkflow(readFileSync('.github/workflows/ci.yml', 'utf8'))
    const command = 'bash scripts/check-contextual-classroom-list-reorder-database.sh'
    for (const lane of ['database', 'all']) {
      const selected = selectPlan(jobs, lane).flatMap(job => job.steps.filter(step => step.run === command).map(step => ({ job, step })))
      expect(selected).toHaveLength(1)
      expect(selected[0].job.id).toBe('architecture-database-contracts')
      const at = selected[0].job.steps.indexOf(selected[0].step)
      expect(selected[0].job.steps[at - 2].run).toBe('bash scripts/check-attendance-decommission-database.sh')
      expect(selected[0].job.steps[at - 1].run).toBe('bash scripts/check-attendance-membership-adoption-database.sh')
      expect(selected[0].job.steps[at + 1].run).toBe('supabase db lint --local --level warning --fail-on warning')
    }
  })
})
