import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractWorkflow, selectPlan } from '../../scripts/run-ci-local.mjs'

describe('recovery rollback contract uses the existing guarded CI database lane', () => {
  it('runs directly after grading with the unchanged daemon and port guards', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
    const job = ci.split('      - name: Verify contextual Test owner inspection, manual grading and return')[1]
      .split('      - name: Verify classroom creation')[0]
    expect(job).toContain('com.supabase.cli.project')
    expect(job).toContain("== 'pika'")
    expect(job).toContain(':54322[[:space:]]*$')
    const grading = 'docker exec -i supabase_db_pika psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < scripts/check-contextual-test-owner-grading.sql'
    const recovery = 'docker exec -i supabase_db_pika psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < scripts/check-contextual-test-owner-recovery.sql'
    expect(job).toContain(`${grading}\n          ${recovery}`)
    expect(ci.split(recovery)).toHaveLength(2)
    const localDatabase = selectPlan(extractWorkflow(ci), 'database')[0]
    expect(localDatabase.steps.some(step => step.run?.includes(recovery))).toBe(true)
  })
})
