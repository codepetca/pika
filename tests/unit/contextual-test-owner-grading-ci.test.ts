import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('owner Test grading CI regression wiring', () => {
  it('runs the exact rollback contracts once in the existing ephemeral database job', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const job = workflow.slice(workflow.indexOf('  architecture-database-contracts:'),
      workflow.indexOf('  architecture-database-contracts-lifecycle:'))
    expect(job.includes('Verify contextual Test owner inspection, manual grading and return')).toBe(true)
    expect(job).toContain("[[ \"$(docker inspect supabase_db_pika --format '{{ index .Config.Labels \"com.supabase.cli.project\" }}')\" == 'pika' ]]")
    expect(job).toContain("docker port supabase_db_pika 5432/tcp | grep -Eq ':54322[[:space:]]*$'")
    const command = 'docker exec -i supabase_db_pika psql -U postgres -d postgres -XqAt -v ON_ERROR_STOP=1 < scripts/check-contextual-test-owner-grading.sql'
    expect(job).toContain(command)
    expect(workflow.split(command)).toHaveLength(2)
    expect(job).toContain('scripts/check-contextual-test-owner-workflow.sql')
    expect(job).toContain('scripts/check-contextual-test-learner-workflow.sql')
  })
})
