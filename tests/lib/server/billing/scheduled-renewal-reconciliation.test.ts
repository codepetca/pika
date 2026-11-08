import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  BillingClaimedSubscription, BillingFinishInput, BillingFinishResult, BillingProviderSubscriptionSnapshot,
  BillingScheduledRenewal, BillingScheduledRenewalFinishInput, BillingSubscriptionBinding,
} from '@/lib/server/billing/contracts'
import { createBillingStore } from '@/lib/server/billing/store'
import { synchronizeBillingSubscription } from '@/lib/server/billing/synchronize'

const paidStart = '2026-12-31T12:00:00.000Z'
const effectiveAt = '2027-01-31T12:00:00.000Z'
const targetEnd = '2027-02-28T12:00:00.000Z'
const eventInboxId = '77777777-7777-4777-8777-777777777777'
const source: BillingSubscriptionBinding = {
  subscription_id: '11111111-1111-4111-8111-111111111111',
  subject_user_id: '22222222-2222-4222-8222-222222222222',
  stripe_account: 'acct_Pika',
  stripe_customer_id: 'cus_Pika',
  stripe_subscription_id: 'sub_Pika',
  offering_id: '33333333-3333-4333-8333-333333333333',
  offering_version_id: '44444444-4444-4444-8444-444444444444',
  stripe_product_id: 'prod_Max',
  stripe_price_id: 'price_Max',
  unit_amount: 2000,
  plan_key: 'pro',
  currency: 'cad',
  interval: 'month',
  provider_mode: 'test',
}
const target: BillingSubscriptionBinding = {
  ...source, offering_id: '55555555-5555-4555-8555-555555555555',
  offering_version_id: '66666666-6666-4666-8666-666666666666',
  stripe_product_id: 'prod_Pro', stripe_price_id: 'price_Pro', unit_amount: 800, interval: 'month', plan_key: 'plus',
}
const claim: BillingClaimedSubscription = {
  status: 'claimed',
  subscription_id: source.subscription_id,
  binding: source,
  lease_token: '88888888-8888-4888-8888-888888888888',
  fencing_token: 9,
  lease_expires_at: '2027-01-31T12:02:00.000Z',
  subscription_revision: 10,
  expected_account_plan_revision: 11,
  lifecycle: {
    paid_through: effectiveAt, paid_period_start: paidStart, last_paid_invoice_id: 'in_Source',
    access_ends_at: effectiveAt, end_reason: 'renewal_pending', assignment_revision: 11, is_current: true,
  },
}
const proof: BillingScheduledRenewal = {
  operation_id: '99999999-9999-4999-8999-999999999999',
  provider_schedule_id: 'sub_sched_Pika',
  effective_at: effectiveAt,
  state: 'scheduled',
  target_binding: target,
}
const claimFence = {
  subscription_id: claim.subscription_id,
  lease_token: claim.lease_token,
  fencing_token: claim.fencing_token,
  expected_subscription_revision: claim.subscription_revision,
  expected_account_plan_revision: claim.expected_account_plan_revision,
  event_inbox_id: eventInboxId,
}
const scheduledFence = {
  ...claimFence,
  operation_id: proof.operation_id,
  provider_schedule_id: proof.provider_schedule_id,
  target_offering_version_id: target.offering_version_id,
}
type InvoiceState = 'paid' | 'pending' | 'failed'

function snapshot(binding: BillingSubscriptionBinding, state: InvoiceState = 'paid') {
  const initial = binding === source
  const start = initial ? paidStart : effectiveAt
  const end = initial ? effectiveAt : targetEnd
  const amount = binding.unit_amount
  const currency = binding.currency
  const customerId = binding.stripe_customer_id
  const subscriptionId = binding.stripe_subscription_id
  const paid = state === 'paid'
  const latestInvoice = {
    id: initial ? 'in_Source' : 'in_Target', status: paid ? 'paid' : state === 'pending' ? 'draft' : 'open',
    billingReason: initial ? 'subscription_create' : 'subscription_cycle',
    currency, customerId, subscriptionId, amountDue: amount, amountPaid: paid ? amount : 0,
    amountPaidOffStripe: 0, subtotal: amount, total: amount, startingBalance: 0,
    endingBalance: state === 'pending' ? null : 0,
    hasDiscounts: false, hasTaxes: false, totalDiscountAmount: 0, totalTaxAmount: 0,
    prePaymentCreditNotesAmount: 0, postPaymentCreditNotesAmount: 0,
    linesFullyEnumerated: true,
    lines: [{ type: 'subscription', subscriptionId, priceId: binding.stripe_price_id, amount, quantity: 1,
      proration: false, hasDiscounts: false, hasTaxes: false, periodStart: start, periodEnd: end }],
    paymentsFullyEnumerated: true,
    payments: paid ? [{
      type: 'payment_intent', status: 'succeeded', paymentIntentId: 'pi_Proof', customerId, currency, amountReceived: amount,
      latestCharge: {
        status: 'succeeded', paid: true, captured: true, refunded: false, amountRefunded: 0,
        disputed: false, customerId, currency, paymentIntentId: 'pi_Proof', paymentMethodType: 'card',
      },
    }] : [],
  } satisfies NonNullable<BillingProviderSubscriptionSnapshot['latestInvoice']>
  return {
    stripeAccount: binding.stripe_account, liveMode: false, isCurrent: true,
    subscriptionId, customerId, status: state === 'failed' ? 'past_due' : 'active',
    pendingUpdate: false, cancelAt: null, cancelAtPeriodEnd: false, pauseCollection: false,
    scheduleId: proof.provider_schedule_id,
    items: [{ productId: binding.stripe_product_id, priceId: binding.stripe_price_id, unitAmount: amount,
      currency, interval: binding.interval, intervalCount: 1, priceLiveMode: false,
      quantity: 1, currentPeriodStart: start, currentPeriodEnd: end }],
    latestInvoice,
  } satisfies BillingProviderSubscriptionSnapshot
}

function fixture(value: unknown) {
  const completion = { status: 'applied', retry_scheduled: false } as const
  const store = {
    claimSubscription: vi.fn<() => Promise<BillingClaimedSubscription>>(async () => claim),
    finishSubscription: vi.fn<(_input: BillingFinishInput) => Promise<BillingFinishResult>>(async () => completion),
    listWork: vi.fn(),
    getAppliedUpgrade: vi.fn(),
    getScheduledRenewal: vi.fn<() => Promise<unknown>>(async () => proof),
    finishScheduledRenewal: vi.fn<(_input: BillingScheduledRenewalFinishInput) => Promise<BillingFinishResult>>(async () => completion),
  }
  const provider = {
    retrieveSubscription: vi.fn(async () => value),
    retrieveAppliedUpgrade: vi.fn(),
    verifyScheduledRenewal: vi.fn<(_proof: BillingScheduledRenewal, _snapshot: BillingProviderSubscriptionSnapshot) => Promise<boolean>>(),
  }
  const run = () => synchronizeBillingSubscription({
    store, provider, subscriptionId: claim.subscription_id, eventInboxId, leaseSeconds: 120,
  })
  return { store, provider, run }
}

describe('scheduled renewal reconciliation', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(effectiveAt)
  })
  afterEach(() => vi.useRealTimers())

  it.each([['paid', 'paid'], ['failed', 'renewal_failed']] as const)(
    'accepts the full target invoice labeled subscription_update for a verified %s phase', async (state, outcome) => {
      const value = snapshot(target, state)
      value.latestInvoice.billingReason = 'subscription_update'
      const { provider, store, run } = fixture(value)
      provider.verifyScheduledRenewal.mockResolvedValue(true)
      await expect(run()).resolves.toEqual({ kind: 'applied' })
      expect(provider.verifyScheduledRenewal).toHaveBeenCalledExactlyOnceWith(proof, value)
      expect(store.finishScheduledRenewal).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        ...scheduledFence, outcome, invoice_id: 'in_Target', period_start: effectiveAt, period_end: targetEnd,
      }))
    },
  )

  it('rejects an update invoice when the freshly read phase is unverified', async () => {
    const value = snapshot(target)
    value.latestInvoice.billingReason = 'subscription_update'
    const { provider, store, run } = fixture(value)
    provider.verifyScheduledRenewal.mockResolvedValue(false)
    await expect(run()).resolves.toMatchObject({ kind: 'exception', reason: 'subscription_transition_unapproved' })
    expect(store.finishScheduledRenewal).not.toHaveBeenCalled()
  })

  it('records only a fenced observation of the exact prior paid term before cutoff', async () => {
    vi.setSystemTime(Date.parse(effectiveAt) - 1)
    const { store, provider, run } = fixture(snapshot(source))
    await expect(run()).resolves.toEqual({ kind: 'applied' })
    expect(store.getScheduledRenewal).toHaveBeenCalledExactlyOnceWith({ subscription_id: claim.subscription_id })
    expect(provider.retrieveSubscription).toHaveBeenCalledExactlyOnceWith(source)
    expect(store.finishSubscription).toHaveBeenCalledExactlyOnceWith({
      ...claimFence, outcome: 'observed', provider_status: 'active', cancel_at_period_end: false, obligations_cleared: false,
      invoice_id: null, period_start: null, period_end: null, reason_code: null,
    })
    expect(store.finishScheduledRenewal).not.toHaveBeenCalled()
  })

  it('records only a fenced observation of an already-applied exact target term until release', async () => {
    const { store, run } = fixture(snapshot(target))
    store.getScheduledRenewal.mockResolvedValueOnce({ ...proof, state: 'applied' })
    store.claimSubscription.mockResolvedValueOnce({
      ...claim, binding: target, lifecycle: { ...claim.lifecycle!, paid_period_start: effectiveAt,
        paid_through: targetEnd, access_ends_at: targetEnd, last_paid_invoice_id: 'in_Target' },
    })
    await expect(run()).resolves.toEqual({ kind: 'applied' })
    expect(store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({
      ...claimFence, outcome: 'observed', invoice_id: null,
    }))
    expect(store.finishScheduledRenewal).not.toHaveBeenCalled()
  })

  it.each([
    ['pending', 'renewal_invoice_pending', 'active', { status: 'deferred', retry_scheduled: true },
      { kind: 'deferred', retryable: true }],
    ['failed', 'renewal_failed', 'past_due', { status: 'applied', retry_scheduled: false }, { kind: 'applied' }],
    ['paid', 'paid', 'active', { status: 'applied', retry_scheduled: false }, { kind: 'applied' }],
  ] as const)('routes exact %s target evidence at the cutoff to its scheduled finisher',
    async (state, outcome, providerStatus, finishResult, expected) => {
      const { store, run } = fixture(snapshot(target, state))
      if (state === 'paid') {
        store.claimSubscription.mockResolvedValueOnce({
          ...claim, lifecycle: { ...claim.lifecycle!, end_reason: 'renewal_grace',
            access_ends_at: '2027-02-07T12:00:00.000Z' },
        })
      }
      store.finishScheduledRenewal.mockResolvedValueOnce(finishResult)
      await expect(run()).resolves.toEqual(expected)
      expect(store.finishScheduledRenewal).toHaveBeenCalledExactlyOnceWith({
        ...scheduledFence, outcome, provider_status: providerStatus, cancel_at_period_end: false, obligations_cleared: false,
        invoice_id: 'in_Target', period_start: effectiveAt, period_end: targetEnd, reason_code: null,
      })
      expect(store.finishSubscription).not.toHaveBeenCalled()
    })

  it('does not submit a paid target invoice before the exact cutoff or observe the old source afterward', async () => {
    vi.setSystemTime(Date.parse(effectiveAt) - 1)
    const early = fixture(snapshot(target))
    await expect(early.run()).resolves.toMatchObject({ kind: 'exception', reason: 'changed_price' })
    expect(early.store.finishScheduledRenewal).not.toHaveBeenCalled()
    vi.setSystemTime(effectiveAt)
    const old = fixture(snapshot(source))
    await expect(old.run()).resolves.toMatchObject({ kind: 'exception', reason: 'invoice_not_bound' })
    expect(old.store.finishScheduledRenewal).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown', null],
    ['malformed', { ...proof, extra: true }],
    ['foreign schedule', { ...proof, provider_schedule_id: 'sub_sched_Other' }],
    ['foreign account', { ...proof, target_binding: { ...target, stripe_account: 'acct_Other' } }],
    ['foreign customer', { ...proof, target_binding: { ...target, stripe_customer_id: 'cus_Other' } }],
    ['foreign mode', { ...proof, target_binding: { ...target, provider_mode: 'live' } }],
    ['unapproved interval', { ...proof, target_binding: { ...target, interval: 'year' } }],
    ['wrong boundary', { ...proof, effective_at: paidStart }],
    ['applied without matching binding', { ...proof, state: 'applied' }],
  ])('fails closed on %s proof without probing an applied upgrade', async (_, stored) => {
    const { store, provider, run } = fixture(snapshot(target))
    store.getScheduledRenewal.mockResolvedValueOnce(stored)
    await expect(run()).resolves.toMatchObject({ kind: 'exception' })
    expect(store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'exception' }))
    expect(store.finishScheduledRenewal).not.toHaveBeenCalled()
    expect(provider.retrieveAppliedUpgrade).not.toHaveBeenCalled()
    expect(store.getAppliedUpgrade).not.toHaveBeenCalled()
  })

  it.each([
    ['subscription mode', { ...snapshot(target), liveMode: true }],
    ['price mode', { ...snapshot(target), items: [{ ...snapshot(target).items[0], priceLiveMode: true }] }],
    ['pending provider transition', { ...snapshot(target), pendingUpdate: true }],
    ['cancellation', { ...snapshot(target), cancelAtPeriodEnd: true }],
    ['terminal failure', { ...snapshot(target, 'failed'), status: 'canceled' }],
    ['missing invoice', { ...snapshot(target), latestInvoice: null }],
    ['malformed snapshot', { ...snapshot(target), items: null }],
    ['changed target', { ...snapshot(target), items: [{ ...snapshot(target).items[0], priceId: 'price_Other' }] }],
    ['non-cycle invoice', { ...snapshot(target), latestInvoice: { ...snapshot(target).latestInvoice, billingReason: 'subscription_create' } }],
    ['replayed source invoice', { ...snapshot(target), latestInvoice: { ...snapshot(target).latestInvoice, id: 'in_Source' } }],
  ])('does not settle invalid %s evidence', async (_, value) => {
    const { store, provider, run } = fixture(value)
    await expect(run()).resolves.toMatchObject({ kind: 'exception' })
    expect(store.finishScheduledRenewal).not.toHaveBeenCalled()
    expect(provider.retrieveAppliedUpgrade).not.toHaveBeenCalled()
  })

  it('rejects a shortened target term even when the full invoice and item agree', async () => {
    const value = snapshot(target)
    const shortEnd = '2027-02-27T12:00:00.000Z'
    const { store, run } = fixture({
      ...value, items: [{ ...value.items[0], currentPeriodEnd: shortEnd }],
      latestInvoice: { ...value.latestInvoice, lines: [{ ...value.latestInvoice.lines[0], periodEnd: shortEnd }] },
    })
    await expect(run()).resolves.toMatchObject({ kind: 'exception', reason: 'invoice_line_unverified' })
    expect(store.finishScheduledRenewal).not.toHaveBeenCalled()
  })

  it('keeps a no-schedule renewal on its original path without querying schedule proof', async () => {
    const value = snapshot(source)
    const { store, run } = fixture({ ...value, scheduleId: null })
    await expect(run()).resolves.toEqual({ kind: 'applied' })
    expect(store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'paid', invoice_id: 'in_Source' }))
    expect(store.getScheduledRenewal).not.toHaveBeenCalled()
    expect(store.finishScheduledRenewal).not.toHaveBeenCalled()
  })

  it('exposes the two scheduled RPCs only when the store is explicitly enabled', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const disabled = createBillingStore({ rpc })
    expect(disabled.getScheduledRenewal).toBeUndefined()
    expect(disabled.finishScheduledRenewal).toBeUndefined()
    const enabled = createBillingStore({ rpc }, true)
    await enabled.getScheduledRenewal?.({ subscription_id: claim.subscription_id })
    const input: BillingScheduledRenewalFinishInput = {
      ...scheduledFence, outcome: 'paid', invoice_id: 'in_Target', period_start: effectiveAt,
      period_end: targetEnd, reason_code: null,
    }
    await enabled.finishScheduledRenewal?.(input)
    expect(rpc.mock.calls).toEqual([
      ['billing_get_scheduled_renewal_v1', { p_request: { subscription_id: claim.subscription_id } }],
      ['billing_finish_scheduled_renewal_v1', { p_request: input }],
    ])
  })
})
