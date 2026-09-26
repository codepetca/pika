import { describe, expect, it, vi } from 'vitest'
import { createStripeBillingProvider } from '@/lib/server/billing/stripe-provider'
import { verifyPaidSubscriptionSnapshot } from '@/lib/server/billing/synchronize'

const binding = {
  subscription_id: '11111111-1111-4111-8111-111111111111',
  subject_user_id: '22222222-2222-4222-8222-222222222222',
  offering_id: '33333333-3333-4333-8333-333333333333',
  offering_version_id: '44444444-4444-4444-8444-444444444444',
  stripe_account: 'acct_fixture', stripe_customer_id: 'cus_fixture',
  stripe_subscription_id: 'sub_fixture', stripe_price_id: 'price_fixture',
  plan_key: 'plus', currency: 'usd', interval: 'month', provider_mode: 'test',
} as const

function fixture() {
  const subscription = {
    id: 'sub_fixture', livemode: false, customer: 'cus_fixture', status: 'active',
    pending_update: null, cancel_at: null, cancel_at_period_end: false,
    pause_collection: null, schedule: null, latest_invoice: 'in_fixture',
    items: { has_more: false, data: [{ quantity: 1,
      current_period_start: 1790812800, current_period_end: 1793491200,
      price: { id: 'price_fixture', livemode: false, currency: 'usd',
        recurring: { interval: 'month', interval_count: 1 } },
    }] },
  }
  const invoice = {
    id: 'in_fixture', livemode: false, status: 'paid', customer: 'cus_fixture',
    currency: 'usd', amount_due: 2000, amount_paid: 2000, amount_remaining: 0,
    parent: { subscription_details: { subscription: 'sub_fixture' } },
    lines: { has_more: false, data: [{ quantity: 1,
      parent: { subscription_item_details: { subscription: 'sub_fixture', proration: false } },
      pricing: { price_details: { price: 'price_fixture' } },
      period: { start: 1790812800, end: 1793491200 },
    }] },
    payments: { has_more: false, data: [{ invoice: 'in_fixture', livemode: false,
      status: 'paid', amount_paid: 2000,
      payment: { type: 'payment_intent', payment_intent: 'pi_fixture' },
    }] },
  }
  const intent = { id: 'pi_fixture', livemode: false, customer: 'cus_fixture',
    currency: 'usd', status: 'succeeded', amount_received: 2000, latest_charge: 'ch_fixture' }
  const charge = { id: 'ch_fixture', livemode: false, customer: 'cus_fixture',
    currency: 'usd', payment_intent: 'pi_fixture', captured: true, paid: true,
    refunded: false, amount_refunded: 0, disputed: false, status: 'succeeded' }
  const sdk = {
    accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_fixture' }) },
    subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
    invoices: { retrieve: vi.fn().mockResolvedValue(invoice) },
    paymentIntents: { retrieve: vi.fn().mockResolvedValue(intent) },
    charges: { retrieve: vi.fn().mockResolvedValue(charge) },
  }
  return { sdk, subscription, invoice, intent, charge }
}

describe('Stripe current-state adapter', () => {
  it('fetches the bound objects and proves an actual Stripe payment before assignment', async () => {
    const { sdk } = fixture()
    const snapshot = await createStripeBillingProvider(sdk).retrieveSubscription(binding)
    expect(verifyPaidSubscriptionSnapshot(binding, snapshot)).toMatchObject({ invoiceId: 'in_fixture' })
    expect(sdk.subscriptions.retrieve).toHaveBeenCalledWith('sub_fixture')
    expect(sdk.paymentIntents.retrieve).toHaveBeenCalledWith('pi_fixture')
  })
  it.each(['partial_refund', 'wrong_account', 'truncated_lines', 'unpaid_intent', 'live_invoice'])('rejects %s', async kind => {
    const f = fixture()
    if (kind === 'partial_refund') f.charge.amount_refunded = 1
    if (kind === 'wrong_account') f.sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_other' })
    if (kind === 'truncated_lines') f.invoice.lines.has_more = true
    if (kind === 'unpaid_intent') f.intent.status = 'processing'
    if (kind === 'live_invoice') f.invoice.livemode = true
    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)
    expect(typeof verifyPaidSubscriptionSnapshot(binding, snapshot)).toBe('string')
  })
  it('propagates transport failures so synchronization can schedule recovery', async () => {
    const { sdk } = fixture()
    sdk.subscriptions.retrieve.mockRejectedValue(new Error('transport failure'))
    await expect(createStripeBillingProvider(sdk).retrieveSubscription(binding)).rejects.toThrow()
  })
})
