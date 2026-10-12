import { readFileSync } from 'node:fs'
import { describe,expect,it } from 'vitest'
import { extractWorkflow,selectPlan } from '../../scripts/run-ci-local.mjs'
describe('unpublication rollback in guarded database CI',()=>{
  it('runs once immediately after recovery under the existing exact project and port guards',()=>{
    const ci=readFileSync('.github/workflows/ci.yml','utf8'),job=ci.split('      - name: Verify contextual Test owner inspection, manual grading and return')[1].split('      - name: Verify classroom creation')[0]
    expect(job).toContain('com.supabase.cli.project');expect(job).toContain("== 'pika'");expect(job).toContain(':54322[[:space:]]*$')
    const recovery='docker exec -i supabase_db_pika psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < scripts/check-contextual-test-owner-recovery.sql'
    const unpublish='docker exec -i supabase_db_pika psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < scripts/check-contextual-test-owner-unpublication.sql'
    expect(job).toContain(`${recovery}\n          ${unpublish}`);expect(ci.split(unpublish)).toHaveLength(2)
    expect(selectPlan(extractWorkflow(ci),'database')[0].steps.some(step=>step.run?.includes(unpublish))).toBe(true)
  })
})
