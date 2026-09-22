import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(),
  'supabase/migrations/204_assignment_ai_usage_expiry_recovery.sql'), 'utf8')
const release = migration.split('create or replace function public.release_feature_usage_v1')[1]
  .split('create or replace function public.reserve_assignment_ai_grading_item_usage_with_lease_v1')[0]
const reserve = migration.split('create or replace function public.reserve_assignment_ai_grading_item_usage_with_lease_v1')[1]

describe('Assignment usage expiry recovery migration', () => {
  it('limits relaxed duplicates to already-expired Assignment reservations without rewriting audit evidence', () => {
    expect(release).toContain("if v_reservation.status = 'released' then")
    expect(release).toContain("v_reservation.release_reason is distinct from p_release_reason")
    expect(release).toContain("v_reservation.release_reason = 'expired'\n        and v_reservation.operation_kind = 'assignment_ai_grading'")
    expect(release).toContain("message = 'feature_usage_release_conflict'")
    const duplicateBranch = release.split("if v_reservation.status = 'released' then")[1].split("if v_reservation.status = 'settled'")[0]
    expect(duplicateBranch).toContain("'duplicate', true")
    expect(duplicateBranch).not.toContain('update public.')
  })

  it('retains operation -> entitlement -> reservation lock order and validates internal failure', () => {
    expect(release.indexOf('pg_advisory_xact_lock')).toBeLessThan(release.indexOf('lock_effective_feature_entitlement_v1'))
    expect(release.indexOf('lock_effective_feature_entitlement_v1')).toBeLessThan(release.indexOf('for update'))
    expect(release).toContain('feature_usage_reservation_binding_mismatch')
    expect(migration.match(/'internal_failure'/g)).toHaveLength(2)
  })

  it('renews only live reservations after lease/resource-fenced generic admission', () => {
    expect(reserve.indexOf('private.lock_metered_assignment_ai_grading_item_v1')).toBeLessThan(reserve.indexOf('public.reserve_feature_usage_v1'))
    expect(reserve.indexOf('public.reserve_feature_usage_v1')).toBeLessThan(reserve.indexOf('update public.feature_usage_reservations'))
    expect(reserve).toContain("set expires_at = v_now + interval '24 hours', updated_at = v_now")
    expect(reserve).toContain("and status = 'reserved'\n    and expires_at > v_now")
    expect(reserve).toContain("jsonb_set(v_result, '{reservation}', to_jsonb(v_reservation))")
    expect(reserve).not.toContain('set status')
  })

  it('retains empty search paths and service-only grants for both replaced functions', () => {
    expect(migration.match(/set search_path = ''/g)).toHaveLength(2)
    expect(migration.match(/from public, anon, authenticated/g)).toHaveLength(2)
    expect(migration.match(/to service_role/g)).toHaveLength(2)
    const ci = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8')
    expect(ci).toContain('bash scripts/check-metered-assignment-ai-grading.sh')
  })
})
