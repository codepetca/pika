import { describe, expect, it } from 'vitest'
import { verifyBillingLifecycleSnapshot } from '@/lib/server/billing/synchronize'
const binding = {
  subscription_id: '11111111-1111-4111-8111-111111111111',
  subject_user_id: '22222222-2222-4222-8222-222222222222',
  stripe_account: 'acct_test_platform',
  stripe_customer_id: 'cus_test_customer',
  stripe_subscription_id: 'sub_test_subscription',
  offering_id: '33333333-3333-4333-8333-333333333333',
  offering_version_id: '44444444-4444-4444-8444-444444444444',
  stripe_product_id: 'prod_preserved',
  stripe_price_id: 'price_preserved',
  unit_amount: 2000,
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
      productId: binding.stripe_product_id,
      priceId: binding.stripe_price_id,
      unitAmount: binding.unit_amount,
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
      billingReason: 'subscription_cycle',
      subtotal: 2000,
      total: 2000,
      startingBalance: 0,
      endingBalance: 0,
      totalDiscountAmount: 0,
      totalTaxAmount: 0,
      hasDiscounts: false,
      hasTaxes: false,
      prePaymentCreditNotesAmount: 0,
      postPaymentCreditNotesAmount: 0,
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
        amount: 2000,
        quantity: 1,
        proration: false,
        hasDiscounts: false,
        hasTaxes: false,
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
          paymentMethodType: 'card',
        },
      }],
    },
    ...overrides,
  }
}


const lifecycleClaim = { ...claim, lifecycle: {
  paid_through: '2026-09-01T00:00:00.000Z', paid_period_start: '2026-08-01T00:00:00.000Z',
  last_paid_invoice_id: 'in_previous', access_ends_at: '2026-09-01T00:00:00.000Z',
  end_reason: 'renewal_pending' as const, assignment_revision: 9, is_current: true,
} }
function failedRenewal() {
  const paid = paidSnapshot()
  return { ...paid, status: 'past_due', latestInvoice: { ...paid.latestInvoice, status: 'open', amountPaid: 0, payments: [] } }
}
describe('verified lifecycle observations', () => {
  it('accepts bound failed renewal evidence without treating it as a payment', () => {
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, failedRenewal())).toMatchObject({ outcome: 'renewal_failed', invoice_id: 'in_paid_1', period_start: lifecycleClaim.lifecycle.paid_through })
  })
  it('does not grant first-purchase failure a grace period', () => {
    expect(verifyBillingLifecycleSnapshot({ ...lifecycleClaim, lifecycle: { ...lifecycleClaim.lifecycle, paid_through: null, last_paid_invoice_id: null } }, failedRenewal())).toBe('invoice_not_paid')
  })
  it('rejects a failed upgrade invoice, wrong renewal period, or incomplete charge accounting', () => {
    const failed = failedRenewal()
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, { ...failed, latestInvoice: { ...failed.latestInvoice, billingReason: 'subscription_update' } })).toBe('invoice_not_bound')
    expect(verifyBillingLifecycleSnapshot({ ...lifecycleClaim, lifecycle: { ...lifecycleClaim.lifecycle, paid_through: '2026-08-30T00:00:00.000Z' } }, failed)).toBe('invoice_line_unverified')
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, { ...failed, latestInvoice: { ...failed.latestInvoice, amountPaid: 1 } })).toBe('financial_terms_unapproved')
  })
  it('honors verified paid term while cancellation is scheduled', () => {
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, paidSnapshot({ cancelAtPeriodEnd: true }))).toMatchObject({ outcome: 'paid', cancel_at_period_end: true, period_end: '2026-10-01T00:00:00.000Z' })
  })
  it('uses previous paid evidence for canceled subscriptions with void renewal invoice', () => {
    const failed = failedRenewal()
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, { ...failed, status: 'canceled', latestInvoice: { ...failed.latestInvoice, status: 'void' } })).toMatchObject({ outcome: 'canceled', obligations_cleared: false })
  })
  it('refuses old subscription bindings and foreign invoice identities', () => {
    expect(verifyBillingLifecycleSnapshot({ ...lifecycleClaim, lifecycle: { ...lifecycleClaim.lifecycle, is_current: false } }, paidSnapshot())).toBe('subscription_not_current')
    const failed = failedRenewal()
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, { ...failed, latestInvoice: { ...failed.latestInvoice, customerId: 'cus_other' } })).toBe('invoice_not_bound')
  })
  it('does not credit a canceled period truncated before its paid invoice line end', () => {
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, paidSnapshot({ cancelAt: '2026-09-15T00:00:00.000Z' }))).toBe('subscription_transition_unapproved')
  })
  it.each(['active', 'past_due', 'unpaid', 'canceled'])('recovers an uncollectible renewal under %s without missed-event timing changing its anchor', status => {
    const failed = failedRenewal()
    const result = verifyBillingLifecycleSnapshot(lifecycleClaim, { ...failed, status,
      latestInvoice: { ...failed.latestInvoice, status: 'uncollectible' } })
    expect(result).toMatchObject({ outcome: 'renewal_failed', period_start: lifecycleClaim.lifecycle.paid_through })
  })
  it('classifies a canceled open renewal before generic cancellation', () => {
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, { ...failedRenewal(), status: 'canceled' })).toMatchObject({ outcome: 'renewal_failed' })
  })
  it('does not turn an active open invoice into failed-renewal proof', () => {
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, { ...failedRenewal(), status: 'active' })).toBe('invoice_not_paid')
  })
  it.each(['active', 'past_due', 'unpaid', 'canceled'])('rejects uncollectible first purchase or partial payment under %s', status => {
    const failed = failedRenewal()
    const snapshot = { ...failed, status, latestInvoice: { ...failed.latestInvoice, status: 'uncollectible' } }
    expect(verifyBillingLifecycleSnapshot({ ...lifecycleClaim, lifecycle: { ...lifecycleClaim.lifecycle, paid_through: null, last_paid_invoice_id: null } }, snapshot)).toBe('invoice_not_paid')
    expect(verifyBillingLifecycleSnapshot(lifecycleClaim, { ...snapshot, latestInvoice: { ...snapshot.latestInvoice, amountPaid: 1 } })).toBe('financial_terms_unapproved')
  })
  it.each(['active', 'canceled'])('keeps old paid invoice replay distinguishable from a new renewal under %s', status => {
    const paid = paidSnapshot({ status })
    const graceClaim = { ...lifecycleClaim, lifecycle: { ...lifecycleClaim.lifecycle,
      paid_through: '2026-10-01T00:00:00.000Z', last_paid_invoice_id: 'in_paid_1',
      access_ends_at: '2026-10-08T00:00:00.000Z', end_reason: 'renewal_grace' as const } }
    expect(verifyBillingLifecycleSnapshot(graceClaim, paid)).toMatchObject({ outcome: 'paid', invoice_id: 'in_paid_1', period_end: graceClaim.lifecycle.paid_through })
  })

})
