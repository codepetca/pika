import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const workflow = read('.github/workflows/ci.yml')
const atomic = read('scripts/check-atomic-test-submit.sh')

describe('required Test lifecycle verification', () => {
  it('selects the real isolated desktop lifecycle cases in the required browser command', () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> }
    expect(pkg.scripts['e2e:ci']).toContain('e2e/test-lifecycle-ci.spec.ts')
    expect(workflow).toContain('PIKA_E2E_LIFECYCLE_FIXTURES: "true"')
    const spec = read('e2e/test-lifecycle-ci.spec.ts')
    expect(spec).not.toMatch(/test\.(skip|fixme)|\.route\(/)
    expect(spec).toContain('expected_revision: initial.attempt.draft_revision')
    expect(spec).toContain('await owned.cleanup()')
  })

  it('requires rollback, observed concurrency, and forced-failure exact teardown after schema replay', () => {
    const start = workflow.indexOf('  architecture-database-contracts:')
    const lane = workflow.slice(start, workflow.indexOf('\n  test-and-build:', start))
    const contracts = lane.indexOf('name: Verify revision-aware Test lifecycle contracts')
    expect(contracts).toBeGreaterThan(lane.indexOf('name: Start ephemeral Supabase and replay migrations'))
    expect(lane).toContain('run: psql -X -v ON_ERROR_STOP=1 -f scripts/check-test-attempt-lifecycle.sql')
    const step = lane.split('name: Verify Test Return lifecycle concurrency and exact cleanup')[1]?.split('      - name:')[0]
    expect(step).toContain('node scripts/check-test-attempt-lifecycle-concurrency.mjs')
    expect(step).toContain('CORE244_FORCE_FAILURE=1')
    expect(step).toContain('Exact fixture teardown and baseline fingerprint: PASS')
    expect(step).not.toMatch(/continue-on-error|if:|\|\| true/)
  })


  it('preserves archived academic rows while asserting a fresh restored attempt revision', () => {
    const policy = read('scripts/check-test-editing-policy-database.sh')
    expect(policy).toContain("when table_name = 'test_attempts' then row_data - 'draft_revision'")
    expect(policy).toContain("restored.draft_revision <= (expected.row_data->>'draft_revision')::bigint")
    expect(policy).toContain('Restored Test attempt did not receive a fresh safe revision')
    expect(policy).toContain('Test editing restored rows differ for %')
    for (const path of ['scripts/check-blueprint-question-ordinal-identity.sh', 'scripts/check-blueprint-question-identity-migration-lifecycle.sh']) {
      expect(read(path)).not.toMatch(/public\.(save|submit)_test_attempt_atomic\(/)
    }
  })

  it('keeps atomic-submit validators and races while calling only revision-aware write RPCs', () => {
    expect(atomic).not.toMatch(/public\.(save|submit)_test_attempt_atomic\(/)
    expect(atomic).toContain('public.start_test_attempt_revision_atomic(p_test_id,p_student_id)')
    expect(atomic).toContain('public.save_test_attempt_revision_atomic(p_test_id,p_student_id,p_responses,v_revision)')
    expect(atomic).toContain('public.submit_test_attempt_revision_atomic(p_test_id,p_student_id,p_responses,v_revision,p_submitted_at)')
    for (const proof of ['Missing required response was accepted', 'Oversized selected option', 'Rejected submissions partially mutated attempt state', 'Concurrent submit left incoherent state', 'run_parent_order_race save 41', 'run_parent_order_race submit 42', 'Rejected stale autosave created partial student work', 'Submit/delete race left orphaned test work']) {
      expect(atomic).toContain(proof)
    }
    expect(atomic).toContain("raise exception 'Atomic Test submit snapshot changed' using errcode='40001'")
    expect(atomic).toContain('revoke all on function private.atomic_test_contract_submit')
    expect(atomic).toContain('drop function if exists private.atomic_test_contract_submit')
  })
})
