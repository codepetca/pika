import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractWorkflow, selectPlan } from '../../scripts/run-ci-local.mjs'

describe('contextual complete-source atomic classroom guidance adoption CI contract', () => {
  it('pins the existing project/port and rollback-only contract without applying schema', () => {
    const script = readFileSync('scripts/check-contextual-classroom-guidance-adoption-database.sh', 'utf8')
    for (const required of ["classroom_guidance_adoption_container='supabase_db_pika'", 'com.supabase.cli.project', ':54322[[:space:]]*$', 'check-contextual-classroom-guidance-adoption.sql', 'ON_ERROR_STOP=1', 'VERBOSITY=sqlstate']) expect(script).toContain(required)
    expect(script).not.toMatch(/--linked|DATABASE_URL|SERVICE_ROLE|db push|db reset|eval /)
  })
  it('selects one literal adoption proof after type generation without disturbing historical proof pairs', () => {
    const jobs = extractWorkflow(readFileSync('.github/workflows/ci.yml', 'utf8'))
    for (const lane of ['database', 'all']) {
      const selected = selectPlan(jobs, lane).flatMap(job => job.steps.filter(step => step.run === 'bash scripts/check-contextual-classroom-guidance-adoption-database.sh').map(step => ({ job, step })))
      expect(selected).toHaveLength(1); expect(selected[0].job.id).toBe('architecture-database-contracts')
      const at = selected[0].job.steps.indexOf(selected[0].step)
      expect(selected[0].job.steps[at - 1].run).toBe('pnpm run db:types:check')
      expect(selected[0].job.steps[at + 1].name).toBe('Verify contextual Test owner workflow database contracts')
    }
  })
})
