import { describe, expect, it, vi } from 'vitest'
import { reconcileBillingSubscriptions } from '@/lib/server/billing/reconcile'
import type { BillingProvider, BillingStore } from '@/lib/server/billing/synchronize'

const binding = {
  subscription_id: '11111111-1111-4111-8111-111111111111',
  subject_user_id: '22222222-2222-4222-8222-222222222222',
  stripe_account: 'acct_test_platform',
  stripe_customer_id: 'cus_test_customer',
  stripe_subscription_id: 'sub_test_subscription',
  offering_id: '33333333-3333-4333-8333-333333333333',
  offering_version_id: '44444444-4444-4444-8444-444444444444',
  stripe_price_id: 'price_preserved',
  plan_key: 'plus',
  currency: 'usd',
  interval: 'month',
  provider_mode: 'test',
} as const

const paidSnapshot = {
  stripeAccount: binding.stripe_account,
  liveMode: false,
  isCurrent: true,
  subscriptionId: binding.stripe_subscription_id,
  customerId: binding.stripe_customer_id,
  status: 'active',
  pendingUpdate: false,
  cancelAt: null,
  cancelAtPeriodEnd: false,
  pauseCollection: false,
  scheduleId: null,
  items: [{
    priceId: binding.stripe_price_id, currency: 'usd', interval: 'month', intervalCount: 1,
    priceLiveMode: false, quantity: 1,
    currentPeriodStart: '2026-09-01T00:00:00.000Z', currentPeriodEnd: '2026-10-01T00:00:00.000Z',
  }],
  latestInvoice: {
    id: 'in_paid_1', status: 'paid', amountDue: 2000, amountPaid: 2000, amountPaidOffStripe: 0,
    currency: 'usd',
    customerId: binding.stripe_customer_id, subscriptionId: binding.stripe_subscription_id,
    linesFullyEnumerated: true,
    lines: [{
      type: 'subscription', subscriptionId: binding.stripe_subscription_id,
      priceId: binding.stripe_price_id,
      quantity: 1, proration: false,
      periodStart: '2026-09-01T00:00:00.000Z', periodEnd: '2026-10-01T00:00:00.000Z',
    }],
    paymentsFullyEnumerated: true,
    payments: [{
      type: 'payment_intent', status: 'succeeded', paymentIntentId: 'pi_paid_1', customerId: binding.stripe_customer_id,
      currency: 'usd', amountReceived: 2000,
      latestCharge: {
        status: 'succeeded', paid: true, captured: true, refunded: false, amountRefunded: 0,
        disputed: false, customerId: binding.stripe_customer_id, currency: 'usd', paymentIntentId: 'pi_paid_1',
      },
    }],
  },
}

describe('reconcileBillingSubscriptions', () => {
  it('uses the same bounded synchronization path for due, known bindings', async () => {
    const store: BillingStore = {
      listWork: vi.fn().mockResolvedValue({
        items: [
          { kind: 'reconcile', event_inbox_id: null, subscription_id: binding.subscription_id, binding, next_attempt_at: null },
          { kind: 'reconcile', event_inbox_id: null, subscription_id: '99999999-9999-4999-8999-999999999999', binding: { ...binding, subscription_id: '99999999-9999-4999-8999-999999999999' }, next_attempt_at: null },
        ],
      }),
      claimSubscription: vi.fn().mockImplementation(({ subscription_id }) => Promise.resolve({
        status: 'claimed', subscription_id,
        lease_token: '55555555-5555-4555-8555-555555555555', fencing_token: 1,
        lease_expires_at: '2026-09-26T14:00:00.000Z', subscription_revision: 1,
        expected_account_plan_revision: 1,
        binding: subscription_id === binding.subscription_id
          ? binding
          : { ...binding, subscription_id },
      })),
      finishSubscription: vi.fn().mockResolvedValue({ status: 'applied', retry_scheduled: false }),
    }
    const provider: BillingProvider = { retrieveSubscription: vi.fn().mockResolvedValue(paidSnapshot) }

    await expect(reconcileBillingSubscriptions({ store, provider, limit: 2, leaseSeconds: 60 }))
      .resolves.toEqual({ requested: 2, processed: 2, applied: 2, replayed: 0, deferred: 0, exceptions: 0 })

    expect(store.listWork).toHaveBeenCalledWith({ limit: 2 })
    expect(store.claimSubscription).toHaveBeenCalledTimes(2)
    expect(provider.retrieveSubscription).toHaveBeenCalledTimes(2)
  })

  it('rejects an unbounded reconcile request before listing work', async () => {
    const store = { listWork: vi.fn() } as unknown as BillingStore
    const provider = {} as BillingProvider

    await expect(reconcileBillingSubscriptions({ store, provider, limit: 101, leaseSeconds: 60 }))
      .rejects.toThrow('Billing reconciliation limit is invalid')
    expect(store.listWork).not.toHaveBeenCalled()
  })

  it('contains one failed due item and continues with the next known binding', async () => {
    const secondId = '99999999-9999-4999-8999-999999999999'
    const store: BillingStore = {
      listWork: vi.fn().mockResolvedValue({ items: [
        { kind: 'reconcile', event_inbox_id: null, subscription_id: binding.subscription_id, binding, next_attempt_at: null },
        { kind: 'reconcile', event_inbox_id: null, subscription_id: secondId, binding: { ...binding, subscription_id: secondId }, next_attempt_at: null },
      ] }),
      claimSubscription: vi.fn()
        .mockRejectedValueOnce(new Error('temporary database failure'))
        .mockResolvedValueOnce({
          status: 'claimed', subscription_id: secondId,
          lease_token: '55555555-5555-4555-8555-555555555555', fencing_token: 2,
          lease_expires_at: '2026-09-26T14:00:00.000Z', subscription_revision: 1,
          expected_account_plan_revision: 1, binding: { ...binding, subscription_id: secondId },
        }),
      finishSubscription: vi.fn().mockResolvedValue({ status: 'applied', retry_scheduled: false }),
    }
    const provider: BillingProvider = { retrieveSubscription: vi.fn().mockResolvedValue(paidSnapshot) }

    await expect(reconcileBillingSubscriptions({ store, provider, limit: 2, leaseSeconds: 60 }))
      .resolves.toEqual({ requested: 2, processed: 2, applied: 1, replayed: 0, deferred: 0, exceptions: 1 })
    expect(provider.retrieveSubscription).toHaveBeenCalledOnce()
  })
})
