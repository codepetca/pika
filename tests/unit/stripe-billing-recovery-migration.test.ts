import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/210_stripe_billing_recovery_guards.sql'),
  'utf8',
)

describe('Stripe billing recovery guards migration', () => {
  it('keeps the purchased Stripe product and amount in every worker binding', () => {
    expect(migration).toContain("'stripe_product_id', version.stripe_product_id")
    expect(migration).toContain("'unit_amount', version.unit_amount")
    expect(migration).toContain("'stripe_product_id', v_version.stripe_product_id")
    expect(migration).toContain("'unit_amount', v_version.unit_amount")
  })

  it('bounds retries and selects globally due work after per-subscription deduplication', () => {
    expect(migration).toContain('alter column next_reconcile_at drop not null')
    expect(migration).toContain('attempt_count between 0 and 5')
    expect(migration).toContain('reconcile_attempt_count between 0 and 5')
    expect(migration).toContain("when 1 then interval '1 minute'")
    expect(migration).toContain("when 4 then interval '8 minutes'")
    expect(migration).toContain("v_binding_attempt >= 5")
    expect(migration).toContain("v_reason <> 'provider_unavailable'")
    expect(migration).toContain('partition by subscription_id')
    expect(migration).toContain('where item_rank = 1')
    expect(migration).toContain('order by due_at, subscription_id')
    expect(migration).toContain("binding.reconcile_state in ('queued', 'retry')")
    expect(migration).toContain("binding.reconcile_state = 'queued' or binding.next_reconcile_at <= clock_timestamp()")
    expect(migration).toContain("v_binding.reconcile_state = 'retry' and v_binding.next_reconcile_at > clock_timestamp()")
  })

  it('requires separate provider and receipt timestamps without inventing old provider history', () => {
    expect(migration).toContain('update public.stripe_billing_event_inbox set event_created_at = null')
    expect(migration).toContain("p_request->>'event_created_at' is null")
    expect(migration).toContain("p_request->>'received_at' is null")
    expect(migration).toContain("(p_request->>'event_created_at')::timestamptz")
    expect(migration).toContain("(p_request->>'received_at')::timestamptz")
  })

  it('keeps permanent failures actionable and permits audited service-only requeue', () => {
    expect(migration).toContain("case when v_binding.id is null then 'exception' else 'received' end")
    expect(migration).toContain("'financial_terms_unapproved'")
    expect(migration).toContain('create function public.billing_requeue_subscription_v1(p_request jsonb)')
    expect(migration).toContain("message = 'stripe_billing_requeue_request_invalid'")
    expect(migration).toContain("outcome in ('paid', 'noop', 'exception', 'failed', 'requeued')")
    expect(migration).toContain("grant execute on function public.billing_requeue_subscription_v1(jsonb) to service_role")
  })

  it('locks an accepted event binding before its inbox row and fences stale work', () => {
    expect(migration).toMatch(/stripe_customer_id = p_request->'payload'->>'customer_id'\s+for update;/)
    expect(migration).toContain('revision = revision + 1, updated_at = clock_timestamp()')
    expect(migration).toContain("'superseded_by_verified_event'")
  })
})
