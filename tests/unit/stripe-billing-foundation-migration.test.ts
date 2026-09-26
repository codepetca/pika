import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/209_stripe_billing_foundation.sql'),
  'utf8',
)

describe('Stripe billing foundation migration', () => {
  it('keeps test-mode billing disabled and keeps provider payloads out of the database', () => {
    expect(migration).toContain('create table private.stripe_billing_settings')
    expect(migration).toContain('sandbox_enabled boolean not null default false')
    expect(migration).toContain("provider_mode text not null default 'test' check (provider_mode = 'test')")
    expect(migration).toContain('private.assert_stripe_billing_sandbox_enabled_v1()')
    expect(migration).not.toMatch(/raw_payload|webhook_payload|provider_payload/)
    expect(migration).toContain('payload_hash text not null')
  })

  it('defines immutable, versioned purchased terms and separate availability', () => {
    expect(migration).toContain('create table public.stripe_billing_offerings')
    expect(migration).toContain('create table public.stripe_billing_offering_versions')
    expect(migration).toContain('classroom_limit integer not null check (classroom_limit >= 0)')
    expect(migration).toContain("interval text not null check (interval in ('month', 'year'))")
    expect(migration).toContain('create table public.stripe_billing_offering_availability')
    expect(migration).toContain('stripe_billing_offering_versions_immutable')
    expect(migration).toContain('stripe_billing_offerings_immutable')
  })

  it('uses service-only JSON RPCs with a durable event inbox and lease fence', () => {
    for (const name of [
      'billing_record_event_v1',
      'billing_list_work_v1',
      'billing_claim_subscription_v1',
      'billing_finish_subscription_v1',
      'billing_fail_subscription_v1',
    ]) {
      expect(migration).toContain(`create function public.${name}(p_request jsonb)`)
    }
    expect(migration).toContain('unique (stripe_account, provider_mode, stripe_event_id)')
    expect(migration).toContain('stripe_billing_event_conflict')
    expect(migration).toContain("fencing_token bigint not null default 0 check (fencing_token >= 0)")
    expect(migration).toContain("v_binding.lease_token is distinct from (p_request->>'lease_token')::uuid")
    expect(migration).toContain("v_plan.revision <> (p_request->>'expected_account_plan_revision')::bigint")
    expect(migration).toContain("'unbound_event'")
    expect(migration).toContain('from public, anon, authenticated, service_role;')
    expect(migration).not.toMatch(/grant (?:insert|update|delete) on table public\.stripe_billing_/i)
  })

  it('uses the stored purchased version for a paid effect and fences the legacy writer', () => {
    expect(migration).toContain('v_version.classroom_limit')
    expect(migration).toMatch(/management_source\s*=\s*'billing'/)
    expect(migration).toContain("message = 'billing_managed_account_plan'")
    expect(migration).toContain('create table public.stripe_billing_invoice_effects')
    expect(migration).toContain('create table public.stripe_billing_subscription_audit')
    expect(migration).toContain('account_plan_audit_new_classroom_limit_check check (new_classroom_limit >= 0)')
  })
})
