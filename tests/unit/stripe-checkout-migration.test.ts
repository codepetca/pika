import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/211_stripe_checkout.sql'), 'utf8')
const foundation = readFileSync(resolve(process.cwd(), 'supabase/migrations/209_stripe_billing_foundation.sql'), 'utf8')
const eligibility = readFileSync(resolve(process.cwd(), 'supabase/migrations/212_stripe_checkout_first_purchase.sql'), 'utf8')

function functionDefinition(sql: string, name: string): string {
  const matches = [...sql.matchAll(new RegExp(
    `create(?: or replace)? function public\\.${name}\\(p_request jsonb\\)[\\s\\S]*?\\$\\$;`, 'g',
  ))]
  expect(matches, `Exactly one definition of ${name}`).toHaveLength(1)
  return matches[0][0]
}

describe('Stripe checkout schema boundary', () => {
  it('limits new purchases and provider resumption to an unchanged legacy Free plan', () => {
    expect(eligibility).toContain('add column reserved_plan_revision bigint check (reserved_plan_revision > 0)')
    for (const name of ['billing_reserve_checkout_v1','billing_claim_checkout_v1','billing_save_checkout_progress_v1','billing_finish_checkout_v1']) {
      const body = functionDefinition(eligibility, name)
      expect(body).toContain("v_plan.plan_key<>'free' or v_plan.management_source<>'legacy'")
      expect(body).toContain("'account-plan-subject:'")
      expect(body).toContain('v_plan.revision<>v_attempt.reserved_plan_revision')
      expect(body).toContain("reason_code='checkout_account_plan_ineligible'")
      expect(body).toContain('security definer')
    }
    expect(eligibility).toContain("errcode='55000',message='checkout_account_plan_ineligible'")
    expect(eligibility).not.toMatch(/update public.account_plans|set_effective_feature_entitlement_v1|set sandbox_enabled/)
  })
  it('preserves binding-before-plan lock ordering and protects first paid synchronization without blocking renewals', () => {
    const finish = functionDefinition(eligibility, 'billing_finish_checkout_v1')
    expect(finish.indexOf("'stripe-binding:'")).toBeLessThan(finish.indexOf("'account-plan-subject:'"))
    const claim = functionDefinition(eligibility, 'billing_claim_subscription_v1')
    expect(claim.indexOf('select * into v_binding')).toBeLessThan(claim.indexOf("'account-plan-subject:'"))
    expect(claim).toContain('and not exists(select 1 from public.stripe_billing_invoice_effects where subscription_id=v_binding.id)')
    expect(claim).toContain("and a.status='bound' and a.reserved_plan_revision=v_plan.revision")
    expect(claim).toContain("reconcile_state='attention'")
    expect(claim).not.toMatch(/from public\.stripe_checkout_attempts[^;]*for update/)
    expect(foundation).toContain("if v_plan.revision <> (p_request->>'expected_account_plan_revision')::bigint then")
  })
  it.each(['billing_bind_customer_v1', 'billing_record_event_v1'])(
    'repairs %s with the exact final migration-209 definition while retaining its grants', name => {
      const original = functionDefinition(foundation, name)
      const repair = functionDefinition(migration, name)
      expect(repair).toBe(original.replace('create function', 'create or replace function'))
      expect(repair).toContain('security definer')
      expect(repair).toContain("set search_path = ''")
      expect(repair).toContain('private.assert_stripe_billing_sandbox_enabled_v1()')
      expect(repair).toContain('pg_advisory_xact_lock(hashtextextended(')
      expect(repair).toContain('20920260926')
      expect(repair.indexOf('pg_advisory_xact_lock')).toBeLessThan(repair.indexOf('select * into v_binding'))
      expect(migration).not.toContain(`drop function public.${name}`)
    },
  )
  it('adds service-only checkout records without enabling billing or writing entitlements', () => {
    for (const table of ['stripe_billing_customers','stripe_checkout_attempts','stripe_checkout_audit']) {
      expect(migration).toContain(`alter table public.${table} enable row level security`)
    }
    expect(migration).not.toMatch(/set sandbox_enabled\s*=\s*true|update public.account_plans|set_effective_feature_entitlement_v1/i)
    expect(migration).toContain('from public,anon,authenticated;')
    expect(migration).not.toMatch(/grant (insert|update|delete) /i)
  })
  it('retains unknown writes as account-blocking attention and expires creation before 24 hours', () => {
    expect(migration).toContain("where status not in ('expired','bound')")
    expect(migration).toContain("interval '23 hours'")
    expect(migration).toContain('request_fingerprint')
    expect(migration).toContain("role='teacher'")
    expect(migration).toContain('checkout_account_already_bound_or_pending')
  })
  it('fences every progress/finalization and adopts early inbox events under the established identity lock', () => {
    expect(migration.match(/v_attempt\.lease_token is null or v_attempt\.lease_expires_at is null/g)).toHaveLength(2)
    expect(migration.match(/v_attempt\.fencing_token is distinct from/g)).toHaveLength(2)
    expect(migration).toContain("'stripe-binding:'||v_version.stripe_account||':test:'")
    expect(migration).toContain('20920260926')
    expect(migration).toContain("and stripe_subscription_id=v_binding.stripe_subscription_id")
    expect(migration).toContain('checkout_subscription_conflict')
  })
  it('preserves immutable catalog identity and bases access confirmation on a paid effect', () => {
    expect(migration).toContain("'catalog_key',v.features->>'catalog_key'")
    expect(migration).toContain('v_offering is distinct from p_request')
    expect(migration).toContain('e.account_plan_revision=p.revision')
    expect(migration).toContain('e.period_end>clock_timestamp()')
    expect(migration).toContain('limit 101')
    expect(migration).not.toContain('1900')
  })
})
