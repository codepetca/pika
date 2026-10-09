import Stripe from 'stripe'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { upgradeQuoteDigest, processUpgrade } from '@/lib/server/billing/upgrade-service'
import type { UpgradeOperation, UpgradeClaim, UpgradeStore } from '@/lib/server/billing/upgrade-contracts'
import { createStripeUpgradeProvider, UpgradeProviderContractError } from '@/lib/server/billing/stripe-upgrade-provider'
import { synchronizeBillingSubscription, type BillingStore } from '@/lib/server/billing/synchronize'

const start = '2026-10-01T00:00:00.000Z'
const end = '2026-11-01T00:00:00.000Z'
const now = '2026-10-16T00:00:00.000Z'
const expires = '2026-10-16T00:15:00.000Z'
const seconds = (value: string) => Date.parse(value) / 1000
const binding = {
  subscription_id: '11111111-1111-4111-8111-111111111111', subject_user_id: '22222222-2222-4222-8222-222222222222',
  offering_id: '33333333-3333-4333-8333-333333333333', offering_version_id: '44444444-4444-4444-8444-444444444444',
  stripe_account: 'acct_fixture', stripe_customer_id: 'cus_fixture', stripe_subscription_id: 'sub_fixture',
  stripe_price_id: 'price_old', stripe_product_id: 'prod_old', unit_amount: 900, plan_key: 'basic',
  currency: 'usd', interval: 'month', provider_mode: 'test',
} as const
const target = { offering_version_id: '55555555-5555-4555-8555-555555555555', plan_key: 'plus',
  stripe_account: 'acct_fixture', stripe_product_id: 'prod_target', stripe_price_id: 'price_target', currency: 'usd',
  interval: 'month', unit_amount: 1900, classroom_limit: 5, catalog_key: 'fixture' } as const
function operation(): UpgradeOperation {
  return {
    operation_id: '66666666-6666-4666-8666-666666666666', subject_user_id: binding.subject_user_id,
    subscription_id: binding.subscription_id, source_binding: binding, target, stage: 'quoted', status: 'queued', revision: 1,
    paid_period_start: start, paid_through: end, last_paid_invoice_id: 'in_original', expires_at: expires,
    invoice_id: 'in_upgrade', payment_intent_id: null, confirmed: false, quote_revision: 1, quote_digest: 'a'.repeat(64),
    quote: { binding, target, subscriptionItemId: 'si_fixture', prorationDate: seconds(now), quotedAt: now,
      paidPeriodStart: start, paidThrough: end, expiresAt: expires, unusedCreditAmount: -450,
      remainingChargeAmount: 950, amountDue: 500, currency: 'usd', nextRecurringAmount: 1900, paymentState: 'payment_required',
      lines: [ { kind: 'old_credit', priceId: 'price_old', subscriptionItemId: 'si_fixture', amount: -450, quantity: 1, periodStart: now, periodEnd: end },
        { kind: 'target_debit', priceId: 'price_target', subscriptionItemId: 'si_fixture', amount: 950, quantity: 1, periodStart: now, periodEnd: end } ],
    },
  }
}
function price(targetPrice = false) {
  return { id: targetPrice ? 'price_target' : 'price_old', livemode: false, active: true, currency: 'usd',
    product: targetPrice ? 'prod_target' : 'prod_old', unit_amount: targetPrice ? 1900 : 900,
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, type: 'recurring', billing_scheme: 'per_unit',
    unit_amount_decimal: targetPrice ? '1900' : '900', custom_unit_amount: null, transform_quantity: null, tax_behavior: 'exclusive' }
}
function line(amount: number) {
  return { id: amount < 0 ? 'il_credit' : 'il_debit', livemode: false, amount, subtotal: amount, quantity: 1, quantity_decimal: '1',
    currency: 'usd', discounts: [] as unknown[], discount_amounts: [] as unknown[], taxes: [] as unknown[], pretax_credit_amounts: [] as unknown[],
    parent: { type: 'invoice_item_details', invoice_item_details: { invoice_item: amount < 0 ? 'ii_credit' : 'ii_debit',
      subscription: 'sub_fixture', proration: false } }, pricing: null,
    period: { start: seconds(now), end: seconds(end) } }
}
function fixture() {
  const op = operation()
  const subscription = { id: 'sub_fixture', livemode: false, customer: 'cus_fixture', status: 'active', pending_update: null,
    cancel_at: null, cancel_at_period_end: false, pause_collection: null, schedule: null, latest_invoice: 'in_original',
    collection_method: 'charge_automatically', automatic_tax: { enabled: false }, discounts: [] as unknown[],
    default_tax_rates: [] as unknown[], pending_invoice_item_interval: null,
    items: { has_more: false, data: [{ id: 'si_fixture', quantity: 1, current_period_start: seconds(start), current_period_end: seconds(end),
      price: price(), discounts: [] as unknown[], tax_rates: [] as unknown[], billing_thresholds: null }] } }
  const invoice = { id: 'in_upgrade', livemode: false, status: 'open', customer: 'cus_fixture', auto_advance: false,
    collection_method: 'charge_automatically', currency: 'usd', amount_due: 500, amount_paid: 0, amount_remaining: 500,
    amount_paid_off_stripe: 0, amount_shipping: 0, billing_reason: 'manual', subtotal: 500, total: 500,
    starting_balance: 0, ending_balance: 0 as number | null, discounts: [] as unknown[], default_tax_rates: [] as unknown[],
    automatic_tax: { enabled: false }, total_discount_amounts: [] as unknown[], total_taxes: [] as unknown[],
    total_pretax_credit_amounts: [] as unknown[], pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_fixture' } },
    lines: { has_more: false, data: [line(-450), line(950)] },
    payments: { has_more: false, data: [] as Array<{ invoice: string; livemode: boolean; currency: string; status: string;
      amount_paid: number | null; amount_requested: number; payment: { type: string; payment_intent: string } }> } }
  const intent = { id: 'pi_upgrade', livemode: false, customer: 'cus_fixture', currency: 'usd', amount: 500,
    amount_received: 0, amount_capturable: 0, status: 'requires_payment_method', latest_charge: null as string | null,
    payment_method_types: ['card'] }
  const charge = { id: 'ch_upgrade', livemode: false, customer: 'cus_fixture', currency: 'usd', payment_intent: 'pi_upgrade',
    amount: 500, amount_captured: 500, status: 'succeeded', paid: true, captured: true, refunded: false,
    amount_refunded: 0, disputed: false, payment_method_details: { type: 'card' } }
  const original = { ...structuredClone(invoice), id: 'in_original', status: 'paid', amount_due: 900, amount_paid: 900,
    amount_remaining: 0, subtotal: 900, total: 900, billing_reason: 'subscription_create',
    lines: { has_more: false, data: [{ ...line(900), parent: { subscription_item_details: { subscription: 'sub_fixture', proration: false } },
      pricing: { price_details: { price: 'price_old' } }, period: { start: seconds(start), end: seconds(end) } }] },
    payments: { has_more: false, data: [{ invoice: 'in_original', livemode: false, status: 'paid', amount_paid: 900,
      payment: { type: 'payment_intent', payment_intent: 'pi_original' } }] } }
  const originalIntent = { ...structuredClone(intent), id: 'pi_original', status: 'succeeded', amount: 900, amount_received: 900, latest_charge: 'ch_original' }
  const originalCharge = { ...structuredClone(charge), id: 'ch_original', payment_intent: 'pi_original', amount: 900, amount_captured: 900 }
  const sdk = { accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_fixture' }) },
    subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription), update: vi.fn().mockResolvedValue({}) },
    prices: { retrieve: vi.fn().mockResolvedValue(price(true)) },
    invoices: { retrieve: vi.fn().mockImplementation(async id => id === 'in_original' ? original : invoice), create: vi.fn().mockResolvedValue(invoice),
      list: vi.fn().mockResolvedValue({ object: 'list', has_more: false, data: [] }), createPreview: vi.fn(),
      finalizeInvoice: vi.fn().mockResolvedValue({}), pay: vi.fn().mockResolvedValue({}), voidInvoice: vi.fn().mockResolvedValue({}) },
    invoiceItems: { create: vi.fn().mockResolvedValue({}) },
    paymentIntents: { retrieve: vi.fn().mockImplementation(async id => id === 'pi_original' ? originalIntent : intent) },
    charges: { retrieve: vi.fn().mockImplementation(async id => id === 'ch_original' ? originalCharge : charge) } }
  const guard = vi.fn().mockResolvedValue(true)
  return { op, subscription, invoice, intent, charge, original, originalIntent, originalCharge, sdk, guard, provider: createStripeUpgradeProvider(sdk),
    write: { operation: op, idempotencyKey: 'upgrade-fixture', beforeMutation: guard } }
}
type Fixture = ReturnType<typeof fixture>
function draftTotals(f: Fixture) {
  const sum = f.invoice.lines.data.reduce((total, item) => total + item.amount, 0)
  Object.assign(f.invoice, { subtotal: sum, total: sum, amount_due: Math.max(0, sum), amount_remaining: Math.max(0, sum), ending_balance: Math.min(0, sum) })
}
function addPayment(f: Fixture, status = 'requires_action') {
  f.invoice.payments.data = [{ invoice: 'in_upgrade', livemode: false, currency: 'usd', status: 'open', amount_paid: 0,
    amount_requested: 500, payment: { type: 'payment_intent', payment_intent: 'pi_upgrade' } }]
  f.intent.status = status
}
function paid(f: Fixture) {
  f.op.confirmed = true; addPayment(f, 'succeeded'); f.invoice.status = 'paid'; f.invoice.amount_paid = 500
  f.invoice.amount_remaining = 0; f.invoice.payments.data[0].status = 'paid'; f.invoice.payments.data[0].amount_paid = 500
  f.intent.amount_received = 500; f.intent.latest_charge = 'ch_upgrade'
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now) })
afterEach(() => { vi.useRealTimers() })

describe('frozen Stripe upgrade invoice', () => {
  it('accepts a frozen manual invoice with null pricing and keeps the provider quote', async () => {
    const f = fixture()
    await expect(f.provider.readEvidence(f.op)).resolves.toEqual({ kind: 'unpaid', invoiceId: 'in_upgrade', status: 'open', quote: f.op.quote })
  })
  it('persists the noncollecting invoice identity before adding frozen lines', async () => {
    const f = fixture(); f.op.invoice_id = null; f.op.stage = 'invoice_requested'; f.invoice.status = 'draft'; f.invoice.ending_balance = null
    f.invoice.lines.data = []; f.sdk.invoiceItems.create.mockImplementation(async input => {
      f.invoice.lines.data.push(line(input.amount)); draftTotals(f); return { id: 'ii_created' }
    })
    draftTotals(f)
    await expect(f.provider.createInvoice(f.write)).resolves.toEqual({ invoiceId: 'in_upgrade' })
    expect(f.sdk.invoiceItems.create).not.toHaveBeenCalled()
    expect(f.sdk.invoices.create).toHaveBeenCalledWith(expect.objectContaining({ customer: 'cus_fixture', subscription: 'sub_fixture',
      auto_advance: false, pending_invoice_items_behavior: 'exclude', collection_method: 'charge_automatically',
      automatic_tax: { enabled: false }, discounts: '', default_tax_rates: [], payment_settings: { payment_method_types: ['card'] } }),
    { idempotencyKey: 'upgrade-fixture' })
    f.op.invoice_id = 'in_upgrade'; f.op.stage = 'invoice_created'; await f.provider.populateInvoice(f.write)
    expect(f.sdk.invoiceItems.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ invoice: 'in_upgrade', amount: -450,
      currency: 'usd', discountable: false, period: { start: seconds(now), end: seconds(end) } }), { idempotencyKey: `pika-upgrade-${f.op.operation_id}-invoice:old_credit` })
    expect(f.sdk.invoiceItems.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ invoice: 'in_upgrade', amount: 950 }),
      { idempotencyKey: `pika-upgrade-${f.op.operation_id}-invoice:target_debit` })
    await f.provider.populateInvoice(f.write)
    expect(f.sdk.invoiceItems.create).toHaveBeenCalledTimes(2)
  })
  it('resumes a known partially populated invoice after a timeout and quote expiry', async () => {
    const f = fixture(); f.op.stage = 'invoice_created'; f.invoice.status = 'draft'; f.invoice.lines.data = []; draftTotals(f)
    f.sdk.invoiceItems.create.mockImplementationOnce(async input => { f.invoice.lines.data.push(line(input.amount)); draftTotals(f); throw new Error('timeout') })
      .mockImplementation(async input => { f.invoice.lines.data.push(line(input.amount)); draftTotals(f); return {} })
    await expect(f.provider.populateInvoice(f.write)).rejects.toThrow('timeout')
    vi.setSystemTime(expires)
    await expect(f.provider.populateInvoice(f.write)).resolves.toBeUndefined()
    expect(f.invoice.lines.data).toHaveLength(2)
    expect(f.sdk.invoices.create).not.toHaveBeenCalled()
  })
  it('finalizes with collection disabled after a fresh guard', async () => {
    const f = fixture(); f.invoice.status = 'draft'; f.invoice.ending_balance = null
    await f.provider.finalizeInvoice(f.write)
    expect(f.sdk.invoices.finalizeInvoice).toHaveBeenCalledWith('in_upgrade', { auto_advance: false }, { idempotencyKey: 'upgrade-fixture' })
    expect(f.guard).toHaveBeenCalledTimes(1)
  })
  it('classifies a definite card decline as attention rather than transport recovery', async () => {
    const f = fixture(); f.op.confirmed = true
    f.sdk.invoices.pay.mockRejectedValueOnce(new Stripe.errors.StripeCardError({ type: 'card_error', message: 'declined', code: 'card_declined', statusCode: 402 }))
    await expect(f.provider.payInvoice(f.write)).rejects.toMatchObject({ reason: 'payment_declined' })
    expect(f.sdk.subscriptions.update).not.toHaveBeenCalled()
  })
  it.each(['open', 'draft', 'partial'] as const)('cleans the exact unpaid %s invoice after the subscription renews', async status => {
    const f = fixture(); f.op.stage = 'void_requested'; f.op.expires_at = end
    f.op.quote!.expiresAt = end
    if (status !== 'open') f.invoice.status = 'draft'
    if (status === 'partial') { f.invoice.lines.data = [line(-450)]; draftTotals(f) }
    vi.setSystemTime(end)
    f.subscription.items.data[0].current_period_start = seconds(end)
    f.subscription.items.data[0].current_period_end = seconds('2026-12-01T00:00:00.000Z')
    // Keep the quote less than 23 hours old for any missing line request.
    f.op.quote!.quotedAt = '2026-10-31T23:50:00.000Z'
    f.op.quote!.prorationDate = seconds(f.op.quote!.quotedAt)
    for (const l of f.op.quote!.lines) l.periodStart = f.op.quote!.quotedAt
    for (const l of f.invoice.lines.data) l.period.start = seconds(f.op.quote!.quotedAt)
    f.sdk.invoiceItems.create.mockImplementation(async input => { const added = line(input.amount); added.period.start = seconds(f.op.quote!.quotedAt); f.invoice.lines.data.push(added); draftTotals(f); return {} })
    f.sdk.invoices.finalizeInvoice.mockImplementation(async () => { f.invoice.status = 'open'; return {} })
    f.sdk.invoices.voidInvoice.mockImplementation(async () => { f.invoice.status = 'void'; f.invoice.amount_remaining = 0; return {} })
    await f.provider.voidInvoice(f.write)
    expect(f.sdk.invoices.voidInvoice).toHaveBeenCalledOnce()
    if (status === 'partial') expect(f.sdk.invoiceItems.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 950 }),
      { idempotencyKey: `pika-upgrade-${f.op.operation_id}-invoice:target_debit` })
    expect(f.sdk.invoices.finalizeInvoice).toHaveBeenCalledTimes(status === 'open' ? 0 : 1)
    await expect(f.provider.readEvidence(f.op)).resolves.toEqual({ kind: 'voided', invoiceId: 'in_upgrade' })
    expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.update).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.retrieve).not.toHaveBeenCalled()
  })
  it('expires a realistic partial credit draft through the coordinator at paid-through', async () => {
    const f = fixture(); f.op.stage = 'invoice_created'; f.op.expires_at = end; f.invoice.status = 'draft'
    Object.assign(f.op.quote!, { quotedAt: '2026-10-31T23:50:00.000Z', prorationDate: seconds('2026-10-31T23:50:00.000Z'), expiresAt: end })
    for (const l of f.op.quote!.lines) l.periodStart = f.op.quote!.quotedAt
    f.invoice.lines.data = [line(-450)]; f.invoice.lines.data[0].period.start = seconds(f.op.quote!.quotedAt); draftTotals(f)
    expect(f.invoice.amount_remaining).toBe(0)
    expect(f.invoice.ending_balance).toBe(-450)
    vi.setSystemTime(end)
    f.sdk.invoiceItems.create.mockImplementation(async input => {
      const added = line(input.amount); added.period.start = seconds(f.op.quote!.quotedAt); f.invoice.lines.data.push(added); draftTotals(f); return {}
    })
    f.sdk.invoices.finalizeInvoice.mockImplementation(async () => { f.invoice.status = 'open'; return {} })
    f.sdk.invoices.voidInvoice.mockImplementation(async () => { f.invoice.status = 'void'; f.invoice.amount_remaining = 0; return {} })
    const claim: UpgradeClaim = { status: 'claimed', operation: f.op, lease_token: binding.subscription_id, fencing_token: 1,
      lease_expires_at: '2026-11-01T00:02:00.000Z', subscription_revision: 1, expected_account_plan_revision: 1,
      expected_access_revision: 1, expected_entitlement_revision: 1 }
    const store: UpgradeStore = { reserve: vi.fn(), get: vi.fn(), confirm: vi.fn(), list: vi.fn(), getApplied: vi.fn(),
      claim: vi.fn().mockImplementation(async () => structuredClone(claim)),
      checkpoint: vi.fn().mockImplementation(async input => { f.op.stage = input.stage; f.op.revision++; return structuredClone(claim) }),
      finish: vi.fn().mockImplementation(async input => ({ status: input.outcome })) }
    f.op.quote_digest = upgradeQuoteDigest(f.op.quote)
    expect(await processUpgrade({ store, provider: f.provider, operationId: f.op.operation_id, leaseSeconds: 120,
      now: () => end })).toEqual({ kind: 'expired' })
    expect(f.sdk.invoices.finalizeInvoice).toHaveBeenCalledOnce()
    expect(f.sdk.invoices.voidInvoice).toHaveBeenCalledOnce()
    expect(f.invoice.total).toBe(500)
    expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.update).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.retrieve).not.toHaveBeenCalled()
  })
  it.each(['pending', 'paid'] as const)('refuses to void %s money after the term ends', async kind => {
    const f = fixture(); f.op.stage = 'void_requested'
    if (kind === 'paid') paid(f); else { f.op.confirmed = true; addPayment(f) }
    vi.setSystemTime(end)
    await f.provider.voidInvoice(f.write)
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
    expect(f.sdk.invoices.finalizeInvoice).not.toHaveBeenCalled()
    expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
  })
  it('pays only a confirmed quote using the same durable key on a timeout retry', async () => {
    const f = fixture(); await f.provider.payInvoice(f.write); expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
    f.op.confirmed = true; f.sdk.invoices.pay.mockRejectedValueOnce(new Error('timeout'))
    await expect(f.provider.payInvoice(f.write)).rejects.toThrow('timeout'); await f.provider.payInvoice(f.write)
    expect(f.sdk.invoices.pay).toHaveBeenNthCalledWith(1, 'in_upgrade', { off_session: true, paid_out_of_band: false }, { idempotencyKey: 'upgrade-fixture' })
    expect(f.sdk.invoices.pay.mock.calls[1]).toEqual(f.sdk.invoices.pay.mock.calls[0])
  })
  it.each(['requires_action', 'processing', 'requires_confirmation', 'requires_capture', 'succeeded'])('never repays or voids a %s payment', async status => {
    const f = fixture(); f.op.confirmed = true; addPayment(f, status)
    await expect(f.provider.readEvidence(f.op)).resolves.toMatchObject({ kind: 'payment_pending' })
    await f.provider.payInvoice(f.write); vi.setSystemTime(expires); await f.provider.voidInvoice(f.write)
    expect(f.sdk.invoices.pay).not.toHaveBeenCalled(); expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })
  it('recognizes a captured payment after quote expiry even when latest_invoice still names the original invoice', async () => {
    const f = fixture(); paid(f); vi.setSystemTime('2026-10-17T00:00:00.000Z')
    await expect(f.provider.readEvidence(f.op)).resolves.toMatchObject({ kind: 'paid', targetApplied: false,
      evidence: { invoiceId: 'in_upgrade', paymentIntentId: 'pi_upgrade', amountPaid: 500, paidPeriodStart: start, paidThrough: end } })
    await f.provider.applyTarget(f.write)
    expect(f.sdk.subscriptions.update).toHaveBeenCalledWith('sub_fixture', { items: [{ id: 'si_fixture', price: 'price_target', quantity: 1 }],
      proration_behavior: 'none', billing_cycle_anchor: 'unchanged' }, { idempotencyKey: 'upgrade-fixture' })
  })
  it('recovers a completed target mutation and never repeats it', async () => {
    const f = fixture(); paid(f); f.subscription.items.data[0].price = price(true)
    await expect(f.provider.readEvidence(f.op)).resolves.toMatchObject({ kind: 'paid', targetApplied: true })
    await f.provider.applyTarget(f.write); expect(f.sdk.subscriptions.update).not.toHaveBeenCalled()
  })
  it('fails closed after crossing the original renewal boundary', async () => {
    const f = fixture(); paid(f); vi.setSystemTime(end)
    await expect(f.provider.readEvidence(f.op)).resolves.toMatchObject({ kind: 'attention' })
    await f.provider.applyTarget(f.write); expect(f.sdk.subscriptions.update).not.toHaveBeenCalled()
  })
  it.each(['payInvoice', 'finalizeInvoice', 'applyTarget', 'voidInvoice'] as const)('honors a false immediate write fence for %s', async method => {
    const f = fixture(); f.op.confirmed = true; f.guard.mockResolvedValue(false)
    if (method === 'finalizeInvoice') f.invoice.status = 'draft'
    if (method === 'applyTarget') paid(f)
    if (method === 'voidInvoice') vi.setSystemTime(expires)
    await f.provider[method](f.write)
    expect(f.sdk.invoices.pay).not.toHaveBeenCalled(); expect(f.sdk.invoices.finalizeInvoice).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.update).not.toHaveBeenCalled(); expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })
  it('does not create an invoice after losing the immediate fence', async () => {
    const f = fixture(); f.op.invoice_id = null; f.op.stage = 'invoice_requested'; f.guard.mockResolvedValue(false)
    await expect(f.provider.createInvoice(f.write)).rejects.toBeInstanceOf(UpgradeProviderContractError)
    expect(f.sdk.invoices.create).not.toHaveBeenCalled()
  })
  it('recovers a requested invoice with the original key after quote expiry', async () => {
    const f = fixture(); f.op.invoice_id = null; f.op.stage = 'invoice_requested'; vi.setSystemTime(expires)
    await expect(f.provider.createInvoice(f.write)).resolves.toEqual({ invoiceId: 'in_upgrade' })
    expect(f.sdk.invoices.create).toHaveBeenCalledWith(expect.objectContaining({ auto_advance: false }), { idempotencyKey: 'upgrade-fixture' })
    expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
  })
  it('never recreates an unknown invoice once the conservative idempotency window has elapsed', async () => {
    const f = fixture(); f.op.invoice_id = null; f.op.stage = 'invoice_requested'
    vi.setSystemTime(new Date(Date.parse(now) + 23 * 60 * 60 * 1000))
    await expect(f.provider.createInvoice(f.write)).rejects.toMatchObject({ reason: 'idempotency_window_elapsed' })
    expect(f.sdk.invoices.create).not.toHaveBeenCalled()
  })
  it('classifies malformed provider creation responses as contract failures rather than transport retries', async () => {
    const f = fixture(); f.op.invoice_id = null; f.op.stage = 'invoice_requested'
    f.sdk.invoices.create.mockResolvedValue({ id: 'foreign' })
    await expect(f.provider.createInvoice(f.write)).rejects.toBeInstanceOf(UpgradeProviderContractError)
  })
  it('classifies malformed subscription facts before invoice creation as contract failures', async () => {
    const f = fixture(); f.op.invoice_id = null; f.op.stage = 'invoice_requested'
    f.subscription.livemode = true
    await expect(f.provider.createInvoice(f.write)).rejects.toBeInstanceOf(UpgradeProviderContractError)
    expect(f.sdk.invoices.create).not.toHaveBeenCalled()
  })
  it('voids an expired completely unpaid invoice, but never voids before expiry', async () => {
    const f = fixture(); await f.provider.voidInvoice(f.write); expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
    vi.setSystemTime(expires); await f.provider.voidInvoice(f.write)
    expect(f.sdk.invoices.voidInvoice).toHaveBeenCalledWith('in_upgrade', {}, { idempotencyKey: 'upgrade-fixture' })
  })
  it.each([
    ['account', (f: Fixture) => f.sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_foreign' })],
    ['subscription', (f: Fixture) => { f.subscription.id = 'sub_foreign' }],
    ['customer', (f: Fixture) => { f.invoice.customer = 'cus_foreign' }],
    ['live', (f: Fixture) => { f.invoice.livemode = true }],
    ['amount', (f: Fixture) => { f.invoice.amount_due++ }],
    ['balance', (f: Fixture) => { f.invoice.starting_balance++ }],
    ['tax', (f: Fixture) => { f.invoice.total_taxes.push({ amount: 10 }) }],
    ['discount', (f: Fixture) => { f.invoice.discounts.push('discount') }],
    ['automatic collection', (f: Fixture) => { f.invoice.auto_advance = true }],
    ['line period', (f: Fixture) => { f.invoice.lines.data[0].period.start++ }],
    ['foreign item', (f: Fixture) => { f.invoice.lines.data.push(line(1)) }],
    ['incomplete lines', (f: Fixture) => { f.invoice.lines.has_more = true }],
    ['incomplete payments', (f: Fixture) => { f.invoice.payments.has_more = true }],
    ['new period', (f: Fixture) => { f.subscription.items.data[0].current_period_end++ }],
    ['target price drift', (f: Fixture) => { f.sdk.prices.retrieve.mockResolvedValue({ ...price(true), unit_amount: 1901 }) }],
  ] as const)('rejects %s without charging', async (_name, change) => {
    const f = fixture(); f.op.confirmed = true; change(f)
    await expect(f.provider.readEvidence(f.op)).resolves.toMatchObject({ kind: 'attention' })
    await f.provider.payInvoice(f.write); expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
  })
  it.each([
    ['partial', (f: Fixture) => { f.intent.amount_received = 100 }],
    ['refunded', (f: Fixture) => { f.charge.refunded = true }],
    ['disputed', (f: Fixture) => { f.charge.disputed = true }],
    ['uncaptured', (f: Fixture) => { f.charge.captured = false }],
    ['off Stripe', (f: Fixture) => { f.invoice.amount_paid_off_stripe = 500 }],
    ['foreign intent', (f: Fixture) => { f.intent.customer = 'cus_foreign' }],
    ['foreign charge', (f: Fixture) => { f.charge.payment_intent = 'pi_foreign' }],
    ['unconfirmed', (f: Fixture) => { f.op.confirmed = false }],
  ] as const)('does not grant %s payment evidence', async (_name, change) => {
    const f = fixture(); paid(f); change(f)
    await expect(f.provider.readEvidence(f.op)).resolves.toMatchObject({ kind: 'attention' })
    await f.provider.applyTarget(f.write); expect(f.sdk.subscriptions.update).not.toHaveBeenCalled()
  })
  it('does not initiate a new charge after quote expiry', async () => {
    const f = fixture(); f.op.confirmed = true; vi.setSystemTime(expires)
    await f.provider.payInvoice(f.write); expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
  })
  it('rejects an original payment refunded after quote preparation before charging the upgrade', async () => {
    const f = fixture(); f.op.confirmed = true; f.originalCharge.refunded = true
    await expect(f.provider.payInvoice(f.write)).rejects.toBeInstanceOf(UpgradeProviderContractError)
    expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
  })
  it('finalizes and then voids an expired draft without ever paying it', async () => {
    const f = fixture(); f.op.stage = 'void_requested'; f.invoice.status = 'draft'; vi.setSystemTime(expires)
    f.sdk.invoices.finalizeInvoice.mockImplementation(async () => { f.invoice.status = 'open'; return {} })
    await f.provider.voidInvoice(f.write)
    expect(f.sdk.invoices.finalizeInvoice).toHaveBeenCalledWith('in_upgrade', { auto_advance: false }, { idempotencyKey: 'upgrade-fixture:finalize' })
    expect(f.sdk.invoices.voidInvoice).toHaveBeenCalledWith('in_upgrade', {}, { idempotencyKey: 'upgrade-fixture' })
    expect(f.guard).toHaveBeenCalledTimes(2); expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
  })
  it('rereads payment evidence and fences again between expired draft finalization and voiding', async () => {
    const f = fixture(); f.op.stage = 'void_requested'; f.invoice.status = 'draft'; vi.setSystemTime(expires)
    f.sdk.invoices.finalizeInvoice.mockImplementation(async () => { f.invoice.status = 'open'; addPayment(f); return {} })
    await f.provider.voidInvoice(f.write)
    expect(f.sdk.invoices.finalizeInvoice).toHaveBeenCalledTimes(1)
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })
})


describe('read-only applied-upgrade cancellation observation', () => {
  function appliedFixture() {
    const f = fixture()
    paid(f)
    f.op.status = 'applied'; f.op.stage = 'applied'; f.op.payment_intent_id = 'pi_upgrade'
    f.op.quote_digest = upgradeQuoteDigest(f.op.quote)
    f.subscription.items.data[0].price = price(true)
    f.subscription.latest_invoice = 'in_upgrade'
    return f
  }
  function noWrites(f: Fixture) {
    expect(f.sdk.subscriptions.update).not.toHaveBeenCalled()
    expect(f.sdk.invoices.create).not.toHaveBeenCalled()
    expect(f.sdk.invoiceItems.create).not.toHaveBeenCalled()
    expect(f.sdk.invoices.finalizeInvoice).not.toHaveBeenCalled()
    expect(f.sdk.invoices.pay).not.toHaveBeenCalled()
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  }
  it('recognizes exact end-of-period cancellation while retaining the original paid term', async () => {
    const f = appliedFixture()
    Object.assign(f.subscription, { cancel_at: seconds(end), cancel_at_period_end: true })
    await expect(f.provider.readAppliedEvidence(f.op)).resolves.toMatchObject({ kind: 'paid', targetApplied: true,
      cancelAt: end, cancelAtPeriodEnd: true, terminalObligationsCleared: false,
      evidence: { invoiceId: 'in_upgrade', paymentIntentId: 'pi_upgrade', providerStatus: 'active',
        paidPeriodStart: start, paidThrough: end, amountPaid: 500 } })
    noWrites(f)
    await expect(f.provider.readEvidence(f.op)).resolves.toMatchObject({ kind: 'attention' })
    noWrites(f)
  })
  it.each(['active', 'canceled'] as const)('reconciles the actual %s adapter result through the fenced cancellation writer contract', async status => {
    const f = appliedFixture()
    Object.assign(f.subscription, { status, cancel_at: seconds(end), cancel_at_period_end: true })
    const store: BillingStore = {
      claimSubscription: vi.fn().mockResolvedValue({ status: 'claimed', subscription_id: binding.subscription_id,
        lease_token: binding.subscription_id, fencing_token: 7, lease_expires_at: end,
        subscription_revision: 4, expected_account_plan_revision: 9,
        binding: { ...binding, offering_version_id: target.offering_version_id, stripe_product_id: target.stripe_product_id,
          stripe_price_id: target.stripe_price_id, unit_amount: target.unit_amount, plan_key: target.plan_key },
        lifecycle: { paid_through: end, paid_period_start: start, last_paid_invoice_id: 'in_original',
          access_ends_at: end, end_reason: 'renewal_pending', assignment_revision: 9, is_current: true } }),
      getAppliedUpgrade: vi.fn().mockResolvedValue({ operation: f.op }), listWork: vi.fn(),
      finishSubscription: vi.fn().mockResolvedValue({ status: 'applied', retry_scheduled: false }),
    }
    await expect(synchronizeBillingSubscription({ store,
      provider: { retrieveSubscription: async () => null, retrieveAppliedUpgrade: f.provider.readAppliedEvidence },
      subscriptionId: binding.subscription_id, eventInboxId: null, leaseSeconds: 120 })).resolves.toEqual({ kind: 'applied' })
    expect(store.finishSubscription).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      outcome: 'canceled', provider_status: status, cancel_at_period_end: true, obligations_cleared: status === 'canceled',
      invoice_id: null, period_start: null, period_end: null, fencing_token: 7,
    }))
    noWrites(f)
  })
  it('observes terminal cancellation at the cutoff only after complete empty unpaid-invoice enumeration', async () => {
    const f = appliedFixture()
    Object.assign(f.subscription, { status: 'canceled', cancel_at: seconds(end), cancel_at_period_end: true })
    vi.setSystemTime(end)
    await expect(f.provider.readAppliedEvidence(f.op)).resolves.toMatchObject({ kind: 'paid',
      terminalObligationsCleared: true, evidence: { providerStatus: 'canceled', paidThrough: end } })
    for (const status of ['draft', 'open', 'uncollectible']) {
      expect(f.sdk.invoices.list).toHaveBeenCalledWith({ subscription: 'sub_fixture', status, limit: 1 })
    }
    noWrites(f)
  })
  it.each(['date_only', 'terminal'] as const)('recognizes %s cancellation even without the period-end flag', async kind => {
    const f = appliedFixture()
    Object.assign(f.subscription, kind === 'terminal' ? { status: 'canceled' } : { cancel_at: seconds(end) })
    await expect(f.provider.readAppliedEvidence(f.op)).resolves.toMatchObject({ kind: 'paid', cancelAtPeriodEnd: false,
      cancelAt: kind === 'terminal' ? null : end, evidence: { providerStatus: kind === 'terminal' ? 'canceled' : 'active' } })
    noWrites(f)
  })
  it.each(['outstanding', 'paginated', 'malformed'] as const)('keeps terminal ownership when unpaid enumeration is %s', async kind => {
    const f = appliedFixture()
    Object.assign(f.subscription, { status: 'canceled', cancel_at_period_end: true })
    f.sdk.invoices.list.mockResolvedValue(kind === 'malformed' ? {} : {
      object: 'list', has_more: kind === 'paginated', data: kind === 'outstanding' ? [{ id: 'in_unpaid' }] : [],
    })
    await expect(f.provider.readAppliedEvidence(f.op)).resolves.toMatchObject({ kind: 'paid', terminalObligationsCleared: false })
    noWrites(f)
  })
  const invalid: Array<[string, (f: Fixture) => void]> = [
    ['wrong cancellation timestamp', f => { Object.assign(f.subscription, { cancel_at: seconds(end) - 1, cancel_at_period_end: true }) }],
    ['foreign subscription', f => { f.subscription.id = 'sub_other' }],
    ['foreign customer', f => { f.subscription.customer = 'cus_other' }],
    ['live environment', f => { f.subscription.livemode = true }],
    ['foreign account', f => { f.sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_other' }) }],
    ['unapproved provider schedule', f => { Object.assign(f.subscription, { schedule: 'sub_sched_other' }) }],
    ['pending provider update', f => { Object.assign(f.subscription, { pending_update: {} }) }],
    ['later renewal period', f => { f.subscription.items.data[0].current_period_end = seconds(end) + 1 }],
    ['source item still active', f => { f.subscription.items.data[0].price = price() }],
    ['wrong item identity', f => { f.subscription.items.data[0].id = 'si_other' }],
    ['unapplied operation', f => { f.op.status = 'queued' }],
    ['unapplied stage', f => { f.op.stage = 'quoted' }],
    ['unconfirmed operation', f => { f.op.confirmed = false }],
    ['wrong saved payment', f => { f.op.payment_intent_id = 'pi_other' }],
    ['missing saved payment', f => { f.op.payment_intent_id = null }],
    ['quote digest drift', f => { f.op.quote_digest = 'b'.repeat(64) }],
    ['quote binding drift', f => { f.op.quote!.binding = { ...f.op.quote!.binding, stripe_customer_id: 'cus_other' } }],
    ['decimal price drift', f => { f.subscription.items.data[0].price.unit_amount_decimal = '1901' }],
    ['refunded charge', f => { f.charge.refunded = true }],
    ['disputed charge', f => { f.charge.disputed = true }],
    ['incomplete capture', f => { f.charge.amount_captured = 499 }],
    ['unexpected latest invoice', f => { f.subscription.latest_invoice = 'in_other' }],
    ['missing latest invoice', f => { Reflect.deleteProperty(f.subscription, 'latest_invoice') }],
    ['malformed latest invoice', f => { Object.assign(f.subscription, { latest_invoice: {} }) }],
  ]
  it.each(invalid)('refuses %s without performing a provider write', async (_name, alter) => {
    const f = appliedFixture(); alter(f)
    await expect(f.provider.readAppliedEvidence(f.op)).resolves.toMatchObject({ kind: 'attention' })
    noWrites(f)
  })
})
