import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractWorkflow, selectPlan } from '../../scripts/run-ci-local.mjs'
describe('whole-Test deletion rollback in guarded database CI', () => {
  it('runs once after unpublication using the unchanged exact project/port guards', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8')
    const job = ci.split('      - name: Verify contextual Test owner inspection, manual grading and return')[1].split('      - name: Verify classroom creation')[0]
    expect(job).toContain('com.supabase.cli.project')
    expect(job).toContain("== 'pika'")
    expect(job).toContain(':54322[[:space:]]*$')
    const prior = 'docker exec -i supabase_db_pika psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < scripts/check-contextual-test-owner-unpublication.sql'
    const deletion = 'docker exec -i supabase_db_pika psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < scripts/check-contextual-test-owner-deletion.sql'
    expect(job).toContain(`${prior}\n          ${deletion}`)
    expect(ci.split(deletion)).toHaveLength(2)
    expect(selectPlan(extractWorkflow(ci), 'database')[0].steps.some(step => step.run?.includes(deletion))).toBe(true)
  })
})
