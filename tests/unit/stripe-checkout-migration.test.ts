import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/211_stripe_checkout.sql'), 'utf8')
const foundation = readFileSync(resolve(process.cwd(), 'supabase/migrations/209_stripe_billing_foundation.sql'), 'utf8')

function functionDefinition(sql: string, name: string): string {
  const matches = [...sql.matchAll(new RegExp(
    `create(?: or replace)? function public\\.${name}\\(p_request jsonb\\)[\\s\\S]*?\\$\\$;`, 'g',
  ))]
  expect(matches, `Exactly one definition of ${name}`).toHaveLength(1)
  return matches[0][0]
}

describe('Stripe checkout schema boundary', () => {
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
