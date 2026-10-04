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


  it('requires setup acknowledgement recovery controls in the same disposable database lane', () => {
    for (const [name, flag, marker] of [
      ['Verify Test lifecycle setup acknowledgement failure exact cleanup', 'CORE244_FORCE_SETUP_ACK_FAILURE=1', 'Exact fixture teardown and baseline fingerprint: PASS'],
      ['Verify managed-storage setup acknowledgement failure exact cleanup', 'MANAGED_STORAGE_FORCE_SETUP_ACK_FAILURE=1', 'Exact managed-storage fixture teardown: PASS'],
    ]) {
      const step = workflow.split(`name: ${name}`)[1]?.split('      - name:')[0]
      expect(step).toContain(flag)
      expect(step).toContain(marker)
      expect(step).toMatch(/\[\[ "\$(?:lifecycle|storage)_ack_status" -ne 0 \]\] \|\| exit 1/)
      expect(step).not.toMatch(/continue-on-error|if:|\|\| true/)
      if (name.includes('managed-storage')) {
        expect(step).toContain('MANAGED_STORAGE_DB_CONTAINER: supabase_db_pika')
        expect(step).toContain('--allow-fixture-writes')
        expect(step).toContain('Forced failure after fixture setup COMMIT before acknowledgement (teardown control)')
      }
    }
  })

  it('prepares committed authority drift behind an observed Classroom row lock, with unchanged academic state', () => {
    const harness = read('scripts/check-test-attempt-lifecycle-concurrency.mjs')
    expect(harness).toContain('parent.relation=\'public.classrooms\'::regclass')
    expect(harness).toContain("parent.mode='RowShareLock'")
    expect(harness).toContain('waiting.transactionid=a.backend_xid')
    expect(harness).toContain("a.end('commit;')")
    expect(harness).toContain('membership removal before reopen')
    expect(harness).toContain('archive before reopen')
    expect(harness).toContain('owner drift before reopen')
    expect(harness).toContain('Authority refusal changed availability/responses/closure/Return/revision')
    expect(harness).toContain('parent-lock negative control')
    expect(harness).toContain('Current enrolled owner could not reopen retained work')
    expect(harness).toContain("closed_for_grading_at=now(), closed_for_grading_by=${teacher}, returned_at=now()")
    const contract = read('scripts/check-test-attempt-lifecycle.sql')
    expect(contract).toContain('Partial selected membership was accepted')
    expect(contract).toContain('Duplicate selected IDs changed the access set')
  })

  it('arms setup attempts before execution and recovers only this run signature, then proves zero residue and baseline', () => {
    const harness = read('scripts/check-test-attempt-lifecycle-concurrency.mjs')
    expect(harness.indexOf('setupAttempted = true')).toBeLessThan(harness.indexOf('await sql(setup)'))
    expect(harness).toContain('const runSignature = randomUUID()')
    expect(harness).toContain('setupAttempted && !ownsFixture')
    expect(harness).toContain('if (probe.owned) ownsFixture = true')
    expect(harness).toContain('refusing deletion. Exact residue fingerprint')
    expect(harness).toContain('CORE244 exact fixture residue after teardown')
    expect(harness).toContain('await fingerprint() !== before')
    expect(harness.indexOf('CORE244_FORCE_SETUP_ACK_FAILURE')).toBeLessThan(harness.indexOf('ownsFixture = true\n  if'))
    expect(harness).toContain('await Promise.allSettled(unfinished.map')
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
