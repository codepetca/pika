import { describe, expect, it, vi } from 'vitest'
import { synchronizeBillingSubscription, type BillingStore, type BillingProvider } from '@/lib/server/billing/synchronize'
import { UpgradeOperationSchema } from '@/lib/server/billing/upgrade-contracts'

const id = '11111111-1111-4111-8111-111111111111'
const subject = '22222222-2222-4222-8222-222222222222'
const version = '33333333-3333-4333-8333-333333333333'
const start = '2026-10-01T00:00:00.000Z', end = '2026-11-01T00:00:00.000Z', now = '2026-10-02T00:00:00.000Z'
const source = { subscription_id: id, subject_user_id: subject, stripe_account: 'acct_test', stripe_customer_id: 'cus_test',
  stripe_subscription_id: 'sub_test', offering_id: id, offering_version_id: id, stripe_product_id: 'prod_old',
  stripe_price_id: 'price_old', unit_amount: 900, plan_key: 'basic', currency: 'usd', interval: 'month', provider_mode: 'test' } as const
const target = { offering_version_id: version, stripe_account: 'acct_test', stripe_product_id: 'prod_new', stripe_price_id: 'price_new',
  plan_key: 'plus', currency: 'usd', interval: 'month', unit_amount: 1900, classroom_limit: 5, catalog_key: 'pika-pro-month-usd-v1' } as const
const quote = { binding: source, target, subscriptionItemId: 'si_test', prorationDate: Date.parse(now) / 1000, quotedAt: now,
  paidPeriodStart: start, paidThrough: end, expiresAt: '2026-10-02T00:15:00.000Z', unusedCreditAmount: -450, remainingChargeAmount: 950,
  amountDue: 500, currency: 'usd', nextRecurringAmount: 1900, paymentState: 'payment_required',
  lines: [{ kind: 'old_credit', priceId: 'price_old', subscriptionItemId: 'si_test', amount: -450, quantity: 1,
    periodStart: now, periodEnd: end }, { kind: 'target_debit', priceId: 'price_new', subscriptionItemId: 'si_test', amount: 950,
    quantity: 1, periodStart: now, periodEnd: end }] }
const operation = UpgradeOperationSchema.parse({ operation_id: id, subject_user_id: subject, subscription_id: id,
  source_binding: source, target, stage: 'applied', status: 'applied', revision: 8, paid_period_start: start, paid_through: end,
  last_paid_invoice_id: 'in_source', expires_at: quote.expiresAt, quote, quote_digest: 'a'.repeat(64), quote_revision: 4,
  invoice_id: 'in_upgrade', payment_intent_id: 'pi_upgrade', confirmed: true })
function fixture() {
  const claim = { status: 'claimed', subscription_id: id, lease_token: id, fencing_token: 2, lease_expires_at: end,
    subscription_revision: 4, expected_account_plan_revision: 9,
    binding: { ...source, offering_version_id: version, stripe_product_id: 'prod_new', stripe_price_id: 'price_new', unit_amount: 1900, plan_key: 'plus' },
    lifecycle: { paid_through: end, paid_period_start: start, last_paid_invoice_id: 'in_source', access_ends_at: end,
      end_reason: 'renewal_pending', assignment_revision: 9, is_current: true } }
  const store: BillingStore = { claimSubscription: vi.fn().mockResolvedValue(claim), listWork: vi.fn(),
    finishSubscription: vi.fn().mockResolvedValue({ status: 'applied', retry_scheduled: false }),
    getAppliedUpgrade: vi.fn().mockResolvedValue({ operation }) }
  const provider: BillingProvider = { retrieveSubscription: vi.fn().mockResolvedValue(null),
    retrieveAppliedUpgrade: vi.fn().mockResolvedValue({ kind: 'paid', targetApplied: true, evidence: {
      invoiceId: 'in_upgrade', paymentIntentId: 'pi_upgrade', subscriptionId: 'sub_test', paymentState: 'paid', providerStatus: 'active',
      amountPaid: 500, currency: 'usd', subscriptionItemId: 'si_test', targetPriceId: 'price_new', paidPeriodStart: start, paidThrough: end } }) }
  const run = () => synchronizeBillingSubscription({ store, provider, subscriptionId: id, eventInboxId: null, leaseSeconds: 120 })
  return { claim, store, provider, run }
}
describe('approved upgrade receipt reconciliation', () => {
  it('observes the same paid term without writing the upgrade invoice as a renewal', async () => {
    const f = fixture()
    expect(await f.run()).toEqual({ kind: 'applied' })
    expect(f.store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'observed',
      invoice_id: null, period_start: null, period_end: null }))
  })
  it('does not trust a receipt for another paid term', async () => {
    const f = fixture()
    f.claim.lifecycle.paid_through = '2026-12-01T00:00:00.000Z'
    expect(await f.run()).toEqual({ kind: 'exception', reason: 'provider_snapshot_invalid', retryable: false })
    expect(f.provider.retrieveAppliedUpgrade).not.toHaveBeenCalled()
  })
  it('keeps a pending or unbound target out of the applied receipt path', async () => {
    const f = fixture()
    vi.mocked(f.provider.retrieveAppliedUpgrade!).mockResolvedValue({ kind: 'payment_pending', invoiceId: 'in_upgrade' })
    expect(await f.run()).toEqual({ kind: 'exception', reason: 'provider_snapshot_invalid', retryable: false })
    expect(f.store.finishSubscription).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'exception' }))
  })
  it('requires the exact stored captured payment identity', async () => {
    const f = fixture()
    vi.mocked(f.store.getAppliedUpgrade!).mockResolvedValue({ operation: { ...operation, payment_intent_id: 'pi_other' } })
    expect(await f.run()).toEqual({ kind: 'exception', reason: 'provider_snapshot_invalid', retryable: false })
  })
})
