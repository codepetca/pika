import { describe, expect, it, vi } from 'vitest'
import { processUpgrade } from '@/lib/server/billing/upgrade-service'
import type { UpgradeClaim, UpgradeProvider, UpgradeStore } from '@/lib/server/billing/upgrade-contracts'

const id = '11111111-1111-4111-8111-111111111111'
const subject = '22222222-2222-4222-8222-222222222222'
const start = '2026-10-01T00:00:00.000Z'
const end = '2026-11-01T00:00:00.000Z'
const now = '2026-10-15T00:00:00.000Z'
const binding = { subscription_id: id, subject_user_id: subject, stripe_account: 'acct_test',
  stripe_customer_id: 'cus_test', stripe_subscription_id: 'sub_test', offering_id: id, offering_version_id: id,
  stripe_product_id: 'prod_old', stripe_price_id: 'price_old', unit_amount: 900,
  plan_key: 'basic', currency: 'usd', interval: 'month', provider_mode: 'test' } as const
const target = { offering_version_id: subject, plan_key: 'plus', stripe_account: 'acct_test',
  stripe_product_id: 'prod_new', stripe_price_id: 'price_new', currency: 'usd', interval: 'month',
  unit_amount: 1900, classroom_limit: 5, catalog_key: 'pika-pro-month-usd-v1' } as const
const quote = { binding, target, subscriptionItemId: 'si_test', prorationDate: Date.parse(now) / 1000,
  quotedAt: now, paidPeriodStart: start, paidThrough: end, expiresAt: '2026-10-15T00:15:00.000Z',
  unusedCreditAmount: -450, remainingChargeAmount: 950, amountDue: 500, currency: 'usd', nextRecurringAmount: 1900,
  lines: [{ kind: 'old_credit', priceId: 'price_old', subscriptionItemId: 'si_test', amount: -450,
    quantity: 1, periodStart: now, periodEnd: end }, { kind: 'target_debit', priceId: 'price_new',
    subscriptionItemId: 'si_test', amount: 950, quantity: 1, periodStart: now, periodEnd: end }],
  paymentState: 'payment_required' } as const
const paid = { invoiceId: 'in_upgrade', paymentIntentId: 'pi_upgrade', subscriptionId: 'sub_test',
  paymentState: 'paid', providerStatus: 'active', amountPaid: 500, currency: 'usd', subscriptionItemId: 'si_test',
  targetPriceId: 'price_new', paidPeriodStart: start, paidThrough: end } as const

function fixture() {
  const claim: UpgradeClaim = { status: 'claimed', lease_token: id, fencing_token: 1,
    lease_expires_at: '2026-10-15T00:02:00.000Z', subscription_revision: 3,
    expected_account_plan_revision: 5, expected_access_revision: 7, expected_entitlement_revision: 9,
    operation: { operation_id: id, subject_user_id: subject, subscription_id: id, source_binding: binding, target,
      stage: 'reserved', status: 'queued', revision: 1, paid_period_start: start, paid_through: end,
      last_paid_invoice_id: 'in_old', expires_at: quote.expiresAt, quote: null, quote_digest: null,
      quote_revision: null, invoice_id: null, payment_intent_id: null, confirmed: false } }
  const store: UpgradeStore = { reserve: vi.fn(), get: vi.fn(), list: vi.fn(), confirm: vi.fn(), getApplied: vi.fn(),
    claim: vi.fn().mockImplementation(async () => structuredClone(claim)),
    checkpoint: vi.fn().mockImplementation(async input => {
      claim.operation.stage = input.stage
      if (input.quote) claim.operation.quote = input.quote
      if (input.invoice_id) claim.operation.invoice_id = input.invoice_id
      if (input.quote_digest) { claim.operation.quote_digest = input.quote_digest; claim.operation.quote_revision = claim.operation.revision + 1 }
      if (input.payment_intent_id) claim.operation.payment_intent_id = input.payment_intent_id
      claim.operation.revision++
      return structuredClone(claim)
    }), finish: vi.fn().mockImplementation(async input => ({ status: input.outcome })) }
  const provider: UpgradeProvider = { prepareQuote: vi.fn().mockResolvedValue(quote),
    createInvoice: vi.fn().mockImplementation(async input => { await input.beforeMutation(); return { invoiceId: 'in_upgrade' } }),
    populateInvoice: vi.fn().mockImplementation(async input => { await input.beforeMutation() }),
    finalizeInvoice: vi.fn().mockImplementation(async input => { await input.beforeMutation() }),
    readEvidence: vi.fn().mockResolvedValue({ kind: 'unpaid', invoiceId: 'in_upgrade', status: 'open', quote }),
    payInvoice: vi.fn().mockImplementation(async input => { await input.beforeMutation() }),
    applyTarget: vi.fn().mockImplementation(async input => { await input.beforeMutation() }),
    voidInvoice: vi.fn().mockImplementation(async input => { await input.beforeMutation() }) }
  const run = () => processUpgrade({ store, provider, operationId: id, now: () => now, leaseSeconds: 120 })
  return { claim, store, provider, run }
}

describe('frozen upgrade coordinator', () => {
  it('prepares the final quote without attempting payment or changing access', async () => {
    const f = fixture()
    expect(await f.run()).toEqual({ kind: 'awaiting_confirmation' })
    expect(f.claim.operation.stage).toBe('quoted')
    expect(f.claim.operation.invoice_id).toBe('in_upgrade')
    expect(f.claim.operation.quote_digest).toMatch(/^[a-f0-9]{64}$/)
    expect(f.provider.payInvoice).not.toHaveBeenCalled()
    expect(f.provider.applyTarget).not.toHaveBeenCalled()
  })
  it('holds the old plan for authentication or processing', async () => {
    const f = fixture()
    Object.assign(f.claim.operation, { stage: 'payment_requested', quote, invoice_id: 'in_upgrade', confirmed: true })
    vi.mocked(f.provider.readEvidence).mockResolvedValue({ kind: 'payment_pending', invoiceId: 'in_upgrade' })
    expect(await f.run()).toEqual({ kind: 'payment_pending' })
    expect(f.provider.payInvoice).not.toHaveBeenCalled()
    expect(f.provider.applyTarget).not.toHaveBeenCalled()
  })
  it('recovers captured payment without a second payment request', async () => {
    const f = fixture()
    Object.assign(f.claim.operation, { stage: 'payment_requested', quote, invoice_id: 'in_upgrade', confirmed: true })
    vi.mocked(f.provider.readEvidence).mockResolvedValueOnce({ kind: 'paid', evidence: paid, targetApplied: false })
      .mockResolvedValue({ kind: 'paid', evidence: paid, targetApplied: true })
    expect(await f.run()).toEqual({ kind: 'applied' })
    expect(f.provider.payInvoice).not.toHaveBeenCalled()
    expect(f.provider.applyTarget).toHaveBeenCalledOnce()
    expect(f.store.finish).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'applied', evidence: paid }))
  })
  it('does not treat an unconfirmed payment as authority to upgrade', async () => {
    const f = fixture()
    Object.assign(f.claim.operation, { stage: 'quoted', quote, invoice_id: 'in_upgrade' })
    vi.mocked(f.provider.readEvidence).mockResolvedValue({ kind: 'paid', evidence: paid, targetApplied: false })
    expect(await f.run()).toEqual({ kind: 'attention', reason: 'unexpected_payment' })
    expect(f.provider.applyTarget).not.toHaveBeenCalled()
  })
  it('preserves intent and idempotency identity when provider creation times out', async () => {
    const f = fixture()
    vi.mocked(f.provider.createInvoice).mockRejectedValueOnce(new Error('network'))
    expect(await f.run()).toEqual({ kind: 'deferred' })
    expect(f.claim.operation.stage).toBe('invoice_requested')
    const key = vi.mocked(f.provider.createInvoice).mock.calls[0][0].idempotencyKey
    await f.run()
    expect(vi.mocked(f.provider.createInvoice).mock.calls[1][0].idempotencyKey).toBe(key)
    expect(f.provider.payInvoice).not.toHaveBeenCalled()
  })
  it('blocks payment when the final quote differs from confirmed facts', async () => {
    const f = fixture()
    Object.assign(f.claim.operation, { stage: 'quoted', quote, invoice_id: 'in_upgrade', confirmed: true })
    vi.mocked(f.provider.readEvidence).mockResolvedValue({ kind: 'unpaid', invoiceId: 'in_upgrade', status: 'open',
      quote: { ...quote, unusedCreditAmount: -449, amountDue: 501,
        lines: [{ ...quote.lines[0], amount: -449 }, quote.lines[1]] } })
    expect(await f.run()).toEqual({ kind: 'attention', reason: 'confirmed_quote_changed' })
    expect(f.provider.payInvoice).not.toHaveBeenCalled()
  })
  it('retains the invoice identity when inserting its lines fails', async () => {
    const f = fixture()
    vi.mocked(f.provider.populateInvoice).mockRejectedValueOnce(new Error('network'))
    expect(await f.run()).toEqual({ kind: 'deferred' })
    expect(f.claim.operation.stage).toBe('invoice_created')
    expect(f.claim.operation.invoice_id).toBe('in_upgrade')
    await f.run()
    expect(f.provider.createInvoice).toHaveBeenCalledOnce()
    expect(f.provider.payInvoice).not.toHaveBeenCalled()
  })
  it('stops stale workers after the immediate mutation checkpoint loses its lease', async () => {
    const f = fixture()
    vi.mocked(f.store.checkpoint).mockResolvedValueOnce({ status: 'lost_claim' })
    expect(await f.run()).toEqual({ kind: 'lost_claim' })
    expect(f.provider.createInvoice).not.toHaveBeenCalled()
  })
  it('never extends a quote across its original paid term', async () => {
    const f = fixture()
    Object.assign(f.claim.operation, { stage: 'payment_requested', quote, invoice_id: 'in_upgrade', confirmed: true })
    expect(await processUpgrade({ store: f.store, provider: f.provider, operationId: id, now: () => end,
      leaseSeconds: 120 })).toEqual({ kind: 'attention', reason: 'paid_period_ended' })
    expect(f.provider.payInvoice).not.toHaveBeenCalled()
    expect(f.provider.applyTarget).not.toHaveBeenCalled()
  })
})
