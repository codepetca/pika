import { describe, expect, it, vi } from 'vitest'
import {
  synchronizeBillingSubscription,
  type BillingProvider,
  type BillingStore,
} from '@/lib/server/billing/synchronize'

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

const claim = {
  status: 'claimed',
  subscription_id: binding.subscription_id,
  lease_token: '55555555-5555-4555-8555-555555555555',
  fencing_token: 7,
  lease_expires_at: '2026-09-26T14:00:00.000Z',
  subscription_revision: 4,
  expected_account_plan_revision: 9,
  binding,
} as const

function paidSnapshot(overrides: Record<string, unknown> = {}) {
  return {
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
      priceId: binding.stripe_price_id,
      currency: binding.currency,
      interval: binding.interval,
      intervalCount: 1,
      priceLiveMode: false,
      quantity: 1,
      currentPeriodStart: '2026-09-01T00:00:00.000Z',
      currentPeriodEnd: '2026-10-01T00:00:00.000Z',
    }],
    latestInvoice: {
      id: 'in_paid_1',
      status: 'paid',
      amountDue: 2000,
      amountPaid: 2000,
      amountPaidOffStripe: 0,
      currency: binding.currency,
      customerId: binding.stripe_customer_id,
      subscriptionId: binding.stripe_subscription_id,
      linesFullyEnumerated: true,
      lines: [{
        type: 'subscription',
        subscriptionId: binding.stripe_subscription_id,
        priceId: binding.stripe_price_id,
        quantity: 1,
        proration: false,
        periodStart: '2026-09-01T00:00:00.000Z',
        periodEnd: '2026-10-01T00:00:00.000Z',
      }],
      paymentsFullyEnumerated: true,
      payments: [{
        type: 'payment_intent', status: 'succeeded', paymentIntentId: 'pi_paid_1',
        customerId: binding.stripe_customer_id, currency: binding.currency, amountReceived: 2000,
        latestCharge: {
          status: 'succeeded', paid: true, captured: true, refunded: false, amountRefunded: 0,
          disputed: false, customerId: binding.stripe_customer_id, currency: binding.currency,
          paymentIntentId: 'pi_paid_1',
        },
      }],
    },
    ...overrides,
  }
}

function storeWith(overrides: Partial<BillingStore> = {}): BillingStore {
  return {
    claimSubscription: vi.fn().mockResolvedValue(claim),
    finishSubscription: vi.fn().mockResolvedValue({
      status: 'applied',
      retry_scheduled: false,
    }),
    listWork: vi.fn(),
    ...overrides,
  }
}

function providerWith(snapshot: unknown): BillingProvider {
  return { retrieveSubscription: vi.fn().mockResolvedValue(snapshot) }
}

describe('synchronizeBillingSubscription', () => {
  it('reuses durable event and invoice effects when a duplicate retry fetches the current subscription', async () => {
    const store = storeWith({
      finishSubscription: vi.fn()
        .mockResolvedValueOnce({ status: 'applied', retry_scheduled: false })
        .mockResolvedValueOnce({ status: 'replayed', retry_scheduled: false }),
    })
    const provider = providerWith(paidSnapshot())
    const input = {
      subscriptionId: binding.subscription_id,
      eventInboxId: '66666666-6666-4666-8666-666666666666',
      leaseSeconds: 60,
    }

    await expect(synchronizeBillingSubscription({ store, provider, ...input }))
      .resolves.toMatchObject({ kind: 'applied' })
    await expect(synchronizeBillingSubscription({ store, provider, ...input }))
      .resolves.toMatchObject({ kind: 'replayed' })

    expect(provider.retrieveSubscription).toHaveBeenCalledTimes(2)
    expect(store.finishSubscription).toHaveBeenNthCalledWith(1, expect.objectContaining({
      event_inbox_id: input.eventInboxId,
      invoice_id: 'in_paid_1',
      outcome: 'paid',
    }))
    expect(store.finishSubscription).toHaveBeenNthCalledWith(2, expect.objectContaining({
      event_inbox_id: input.eventInboxId,
      invoice_id: 'in_paid_1',
      outcome: 'paid',
    }))
  })

  it('allows a fresh fencing claim after a lease expired and applies only its token', async () => {
    const freshClaim = { ...claim, lease_token: '77777777-7777-4777-8777-777777777777', fencing_token: 8 }
    const store = storeWith({ claimSubscription: vi.fn().mockResolvedValue(freshClaim) })

    await synchronizeBillingSubscription({
      store,
      provider: providerWith(paidSnapshot()),
      subscriptionId: binding.subscription_id,
      eventInboxId: null,
      leaseSeconds: 60,
    })

    expect(store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({
      lease_token: freshClaim.lease_token,
      fencing_token: 8,
      expected_subscription_revision: claim.subscription_revision,
      expected_account_plan_revision: claim.expected_account_plan_revision,
    }))
  })

  it('preserves the existing grant and schedules a durable retry when provider refresh fails', async () => {
    const store = storeWith()
    const provider: BillingProvider = { retrieveSubscription: vi.fn().mockRejectedValue(new Error('network unavailable')) }

    await expect(synchronizeBillingSubscription({
      store,
      provider,
      subscriptionId: binding.subscription_id,
      eventInboxId: null,
      leaseSeconds: 60,
    })).resolves.toMatchObject({ kind: 'exception', reason: 'provider_unavailable' })

    expect(store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'exception',
      reason_code: 'provider_unavailable',
      invoice_id: null,
      period_start: null,
      period_end: null,
    }))
  })

  it('treats an unknown changed price as an exception and never moves to a latest catalog version', async () => {
    const store = storeWith()

    await expect(synchronizeBillingSubscription({
      store,
      provider: providerWith(paidSnapshot({ items: [{
        priceId: 'price_unbound_changed', currency: 'usd', interval: 'month', intervalCount: 1,
        priceLiveMode: false, quantity: 1,
        currentPeriodStart: '2026-09-01T00:00:00.000Z',
        currentPeriodEnd: '2026-10-01T00:00:00.000Z',
      }] })),
      subscriptionId: binding.subscription_id,
      eventInboxId: null,
      leaseSeconds: 60,
    })).resolves.toMatchObject({ kind: 'exception', reason: 'changed_price' })

    expect(store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'exception',
      reason_code: 'changed_price',
    }))
  })

  it('uses an archived binding version for a verified paid renewal', async () => {
    const archivedBinding = { ...binding, offering_version_id: '88888888-8888-4888-8888-888888888888' }
    const store = storeWith({ claimSubscription: vi.fn().mockResolvedValue({ ...claim, binding: archivedBinding }) })

    await expect(synchronizeBillingSubscription({
      store,
      provider: providerWith(paidSnapshot()),
      subscriptionId: binding.subscription_id,
      eventInboxId: null,
      leaseSeconds: 60,
    })).resolves.toMatchObject({ kind: 'applied' })

    expect(store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({
      invoice_id: 'in_paid_1',
      outcome: 'paid',
    }))
  })

  it.each([
    ['a foreign Stripe account', (snapshot: ReturnType<typeof paidSnapshot>) => ({ ...snapshot, stripeAccount: 'acct_other' }), 'provider_environment_invalid'],
    ['a live-mode subscription', (snapshot: ReturnType<typeof paidSnapshot>) => ({ ...snapshot, liveMode: true }), 'provider_environment_invalid'],
    ['a scheduled cancellation', (snapshot: ReturnType<typeof paidSnapshot>) => ({ ...snapshot, cancelAtPeriodEnd: true }), 'subscription_transition_unapproved'],
    ['paused collection', (snapshot: ReturnType<typeof paidSnapshot>) => ({ ...snapshot, pauseCollection: true }), 'subscription_transition_unapproved'],
    ['a subscription schedule', (snapshot: ReturnType<typeof paidSnapshot>) => ({ ...snapshot, scheduleId: 'sub_sched_unapproved' }), 'subscription_transition_unapproved'],
    ['a partial refund', (snapshot: ReturnType<typeof paidSnapshot>) => ({
      ...snapshot,
      latestInvoice: {
        ...snapshot.latestInvoice,
        payments: [{ ...snapshot.latestInvoice.payments[0], latestCharge: {
          ...snapshot.latestInvoice.payments[0].latestCharge, refunded: true, amountRefunded: 1,
        } }],
      },
    }), 'provider_snapshot_invalid'],
    ['a payment intent for another customer', (snapshot: ReturnType<typeof paidSnapshot>) => ({
      ...snapshot,
      latestInvoice: { ...snapshot.latestInvoice, payments: [{
        ...snapshot.latestInvoice.payments[0], customerId: 'cus_other', latestCharge: {
          ...snapshot.latestInvoice.payments[0].latestCharge, customerId: 'cus_other',
        },
      }] },
    }), 'invoice_payment_unapproved'],
    ['an invoice for another customer', (snapshot: ReturnType<typeof paidSnapshot>) => ({
      ...snapshot,
      latestInvoice: { ...snapshot.latestInvoice, customerId: 'cus_other' },
    }), 'invoice_not_bound'],
    ['a stale invoice line period', (snapshot: ReturnType<typeof paidSnapshot>) => ({
      ...snapshot,
      latestInvoice: { ...snapshot.latestInvoice, lines: [{
        ...snapshot.latestInvoice.lines[0], periodEnd: '2026-09-30T00:00:00.000Z',
      }] },
    }), 'invoice_line_unverified'],
    ['a partial invoice payment', (snapshot: ReturnType<typeof paidSnapshot>) => ({
      ...snapshot,
      latestInvoice: { ...snapshot.latestInvoice, amountPaid: 1999 },
    }), 'invoice_payment_unapproved'],
    ['a zero amount invoice', (snapshot: ReturnType<typeof paidSnapshot>) => ({
      ...snapshot,
      latestInvoice: { ...snapshot.latestInvoice, amountDue: 0, amountPaid: 0, payments: [] },
    }), 'invoice_payment_unapproved'],
    ['an incompletely expanded invoice', (snapshot: ReturnType<typeof paidSnapshot>) => ({
      ...snapshot,
      latestInvoice: { ...snapshot.latestInvoice, linesFullyEnumerated: false },
    }), 'provider_snapshot_invalid'],
  ])('preserves access for %s', async (_name, mutate, reason) => {
    const store = storeWith()
    await expect(synchronizeBillingSubscription({
      store,
      provider: providerWith(mutate(paidSnapshot())),
      subscriptionId: binding.subscription_id,
      eventInboxId: null,
      leaseSeconds: 60,
    })).resolves.toMatchObject({ kind: 'exception', reason })
    expect(store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'exception', reason_code: reason,
    }))
  })

  it('does not let an expired worker or a manual plan revision overwrite later state', async () => {
    const lostClaimStore = storeWith({
      finishSubscription: vi.fn().mockResolvedValue({ status: 'lost_claim', retry_scheduled: true }),
    })
    await expect(synchronizeBillingSubscription({
      store: lostClaimStore, provider: providerWith(paidSnapshot()), subscriptionId: binding.subscription_id,
      eventInboxId: null, leaseSeconds: 60,
    })).resolves.toEqual({ kind: 'lost_claim', retryable: true })

    const planConflictStore = storeWith({
      finishSubscription: vi.fn().mockResolvedValue({ status: 'plan_conflict', retry_scheduled: true }),
    })
    await expect(synchronizeBillingSubscription({
      store: planConflictStore, provider: providerWith(paidSnapshot()), subscriptionId: binding.subscription_id,
      eventInboxId: null, leaseSeconds: 60,
    })).resolves.toEqual({ kind: 'plan_conflict', retryable: true })
  })

  it('rejects a claimed binding whose identity does not match the requested subscription', async () => {
    const store = storeWith({
      claimSubscription: vi.fn().mockResolvedValue({
        ...claim,
        binding: { ...binding, subscription_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
      }),
    })
    await expect(synchronizeBillingSubscription({
      store, provider: providerWith(paidSnapshot()), subscriptionId: binding.subscription_id,
      eventInboxId: null, leaseSeconds: 60,
    })).rejects.toThrow('does not match')
    expect(store.finishSubscription).not.toHaveBeenCalled()
  })

  it('allows a later fresh claim to recover after a completion transport failure', async () => {
    const failedStore = storeWith({ finishSubscription: vi.fn().mockRejectedValue(new Error('transport')) })
    await expect(synchronizeBillingSubscription({
      store: failedStore, provider: providerWith(paidSnapshot()), subscriptionId: binding.subscription_id,
      eventInboxId: null, leaseSeconds: 60,
    })).rejects.toThrow('transport')

    const recoveredStore = storeWith({
      claimSubscription: vi.fn().mockResolvedValue({ ...claim, fencing_token: 8 }),
    })
    await expect(synchronizeBillingSubscription({
      store: recoveredStore, provider: providerWith(paidSnapshot()), subscriptionId: binding.subscription_id,
      eventInboxId: null, leaseSeconds: 60,
    })).resolves.toEqual({ kind: 'applied' })
    expect(recoveredStore.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({ fencing_token: 8 }))
  })
})
