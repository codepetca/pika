import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/201_metered_feature_usage_reservations.sql'),
  'utf8',
)

describe('metered feature usage reservation migration', () => {
  it('defines a private-by-default, service-owned reservation ledger', () => {
    expect(migration).toContain('create table public.feature_usage_reservations')
    expect(migration).toContain("feature_key text not null check (feature_key = 'grading.ai')")
    expect(migration).toContain("'assignment_ai_grading'")
    expect(migration).toContain("'test_ai_grading'")
    expect(migration).toContain("'repository_review'")
    expect(migration).toContain('alter table public.feature_usage_reservations enable row level security')
    expect(migration).toContain('revoke all on table public.feature_usage_reservations')
    expect(migration).toContain('grant select on table public.feature_usage_reservations to service_role')
  })

  it('serializes idempotency before the entitlement quota bucket', () => {
    expect(migration).toContain("'feature-usage-operation:' || p_operation_id::text")
    expect(migration).toContain('perform public.lock_effective_feature_entitlement_v1(')
    expect(migration.indexOf("'feature-usage-operation:' || p_operation_id::text"))
      .toBeLessThan(migration.indexOf('perform public.lock_effective_feature_entitlement_v1('))
    expect(migration).toContain("message = 'feature_usage_operation_conflict'")
    expect(migration).toContain("message = 'feature_usage_reference_conflict'")
    expect(migration).toContain("message = 'feature_usage_release_conflict'")
  })

  it('counts active reservations and settlements before committing quota', () => {
    expect(migration).toContain("reservation.status in ('reserved', 'settled')")
    expect(migration).toContain('entitlement_revision = v_entitlement.revision')
    expect(migration).toContain("message = 'feature_usage_quota_exhausted'")
    expect(migration).toContain('create function public.settle_feature_usage_v1(')
    expect(migration).toContain('create function public.release_feature_usage_v1(')
  })

  it('keeps every mutation service-role only with an empty search path', () => {
    expect(migration.match(/security definer/g)).toHaveLength(3)
    expect(migration.match(/set search_path = ''/g)).toHaveLength(3)
    expect(migration.match(/grant execute on function public\./g)).toHaveLength(3)
    expect(migration).toContain('from public, anon, authenticated;')
  })
})
