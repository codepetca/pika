import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/167_idempotent_classroom_creation.sql'),
  'utf8',
)

describe('idempotent classroom creation migration', () => {
  it('keeps operation records and the creation RPC service-only', () => {
    expect(migration).toContain('create table public.classroom_creation_operations')
    expect(migration).toContain('alter table public.classroom_creation_operations enable row level security')
    expect(migration).toContain('grant select on table public.classroom_creation_operations to service_role')
    expect(migration).not.toContain('grant insert on table public.classroom_creation_operations')
    expect(migration).toContain('grant execute on function public.create_classroom_atomic_v1(')
    expect(migration).not.toMatch(/to authenticated;/)
  })

  it('serializes entitlement admission and same-operation replay before inserting', () => {
    expect(migration).toMatch(
      /lock_effective_feature_entitlement_v1[\s\S]*classroom-creation-operation:[\s\S]*select \* into v_operation/,
    )
    expect(migration).toMatch(
      /if v_operation\.operation_id is not null then[\s\S]*'replayed', true/,
    )
    expect(migration).toMatch(
      /assert_classroom_creation_allowed_v1[\s\S]*insert into public\.classrooms[\s\S]*insert into public\.classroom_creation_operations/,
    )
  })

  it('binds operation reuse to the same account and caller-controlled request', () => {
    expect(migration).toContain('v_operation.subject_user_id <> p_subject_user_id')
    expect(migration).toContain('v_operation.request_sha256 <> p_request_sha256')
    expect(migration).toContain("'classroom_creation_idempotency_conflict'")
    expect(migration).toContain("'classroom_creation_result_unavailable'")
    expect(migration).toContain('and teacher_id = p_subject_user_id')
  })

  it('does not seed an entitlement cohort or encode a product plan', () => {
    expect(migration).not.toMatch(/insert into public\.effective_feature_entitlements/i)
    expect(migration).not.toMatch(/plan_name|subscription|billing_customer|stripe/i)
  })
})
