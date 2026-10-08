import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/202_assignment_ai_grading_lease_fencing.sql'),
  'utf8',
)

describe('assignment AI grading lease fencing migration', () => {
  it('checks both the run and item lease before mutation or finalization', () => {
    expect(migration).toContain('worker_contract_version smallint not null default 0')
    expect(migration).toContain('v_run.worker_contract_version <> 1')
    expect(migration).toContain('run.lease_token is distinct from p_lease_token')
    expect(migration).toContain('run.lease_expires_at <= clock_timestamp()')
    expect(migration).toContain('item.run_id = v_run.id')
    expect(migration).toContain("item.status in ('queued', 'processing')")
    expect(migration).toContain('finalize_assignment_ai_grading_item_with_provenance_lease_v1')
  })

  it('keeps every mutation service-only with a fixed search path', () => {
    expect(migration.match(/security definer/g)).toHaveLength(4)
    expect(migration.match(/set search_path = ''/g)).toHaveLength(6)
    expect(migration).toContain('from public, anon, authenticated, service_role')
    expect(migration).toContain('to service_role')
    expect(migration).toContain('guard_assignment_ai_grading_run_lease_contract')
    expect(migration).toContain('guard_assignment_ai_grading_item_lease_contract')
    expect(migration.match(/before insert or update or delete/g)).toHaveLength(2)
    expect(migration).toContain('revoke execute on function public.finalize_assignment_ai_grading_item_atomic')
  })
})
