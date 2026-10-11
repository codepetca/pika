import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('learner Test workflow CI regression wiring', () => {
  it('runs the exact rollback contracts in the existing ephemeral database job', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const job = workflow.slice(workflow.indexOf('  architecture-database-contracts:'),
      workflow.indexOf('  contextual-test-owner-sdk:'))
    expect(job.includes('Verify contextual Test learner workflow authority and lifecycle')).toBe(true)
    expect(job.includes('docker exec -i supabase_db_pika psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < scripts/check-contextual-test-learner-workflow.sql')).toBe(true)
    expect(workflow.includes('scripts/check-contextual-test-owner-workflow.sql')).toBe(true)
  })
})
