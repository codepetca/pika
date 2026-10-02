import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const harness = readFileSync('scripts/check-contextual-lesson-plan-copy-write-concurrency.mjs', 'utf8')

describe('contextual lesson-plan copy synthetic verification', () => {
  it('requires the explicit local project, port and already-applied migration', () => {
    expect(harness).toContain("const container = 'supabase_db_pika'")
    expect(harness).toContain('com.supabase.cli.project')
    expect(harness).toContain('54322')
    expect(harness).toContain("where version='229'")
    expect(harness).not.toMatch(/supabase.*(?:db reset|db push|migration up)/)
  })

  it('observes real blocking and exercises copy in both write orderings', () => {
    expect(harness).toContain('pg_blocking_pids(w.pid)')
    expect(harness).toContain('copy_after_${label}')
    expect(harness).toContain('copy_before_${label}')
    expect(harness).toContain('copy_after_fresh_insert')
    expect(harness).toContain('copy_before_fresh_insert')
    expect(harness).toContain('copy_after_delete_${date}')
    expect(harness).toContain('reverse_second')
  })

  it('proves late-failure rollback before the outer test transaction rolls back', () => {
    const compare = harness.indexOf('if before_state is distinct from after_state')
    const outerRollback = harness.indexOf('rollback;`)', compare)
    expect(compare).toBeGreaterThan(0)
    expect(outerRollback).toBeGreaterThan(compare)
    expect(harness).toContain('create trigger zz_${tag}_failure')
    expect(harness).not.toMatch(/disable trigger|set session_replication_role/i)
  })

  it('cleans durable manual and automatic audit rows by exact tagged identities and verifies zero residue', () => {
    expect(harness).toContain('--verify-cleanup-after-fixture')
    expect(harness).toContain('copy_audit_cleanup_ops(operation_id uuid,subject_user_id uuid')
    expect(harness).toContain('default_free_account_provisioning')
    expect(harness).toContain('system:user-provisioning')
    expect(harness).toContain('audit.operation_id=operation.operation_id and audit.subject_user_id=operation.subject_user_id')
    expect(harness).toContain("audit.actor_ref='test:229'")
    expect(harness).toContain('PASS exact synthetic fixture cleanup with zero residual rows')
    expect(harness).not.toContain('delete from public.course_blueprints')
    expect(harness).toContain('delete from public.users')
  })

  it('runs both normal verification and portable forced-failure cleanup proof in CI', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8')
    const step = workflow.split('name: Verify contextual lesson-plan copy atomicity and failed-fixture cleanup')[1]
      ?.split('\n      - name:')[0] ?? ''
    expect(step).toContain('node scripts/check-contextual-lesson-plan-copy-write-concurrency.mjs\n')
    expect(step).toContain('--verify-cleanup-after-fixture')
    expect(step).toContain("grep -F 'Error: Forced post-fixture cleanup proof'")
    expect(step).toContain("grep -F 'PASS exact synthetic fixture cleanup with zero residual rows'")
    expect(step).not.toContain('rg -F')
  })
})
