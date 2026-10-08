import Stripe from 'stripe'
import { describe, expect, it, vi } from 'vitest'
import { UpgradeQuoteContractError, UpgradeQuoteFactsSchema } from '@/lib/server/billing/upgrade-quote-contracts'
import { createStripeUpgradeQuotePort, createStripeUpgradeQuoteProvider } from '@/lib/server/billing/stripe-upgrade-quote-provider'

const start = 1790812800
const end = 1793491200
const now = 1792152000
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()
const binding = {
  subscription_id: '11111111-1111-4111-8111-111111111111',
  subject_user_id: '22222222-2222-4222-8222-222222222222',
  offering_id: '33333333-3333-4333-8333-333333333333',
  offering_version_id: '44444444-4444-4444-8444-444444444444',
  stripe_account: 'acct_fixture', stripe_customer_id: 'cus_fixture', stripe_subscription_id: 'sub_fixture',
  stripe_price_id: 'price_old', stripe_product_id: 'prod_old', unit_amount: 2000,
  plan_key: 'basic', currency: 'usd', interval: 'month', provider_mode: 'test',
} as const
const target = {
  offering_version_id: '55555555-5555-4555-8555-555555555555',
  stripe_account: 'acct_fixture', stripe_price_id: 'price_target', stripe_product_id: 'prod_target',
  plan_key: 'plus', currency: 'usd', interval: 'month', unit_amount: 4000, classroom_limit: 3,
  catalog_key: 'plus-month-usd-v1',
} as const

function fixture() {
  const oldPrice = { id: 'price_old', livemode: false, active: false, product: 'prod_old',
    currency: 'usd', unit_amount: 2000, unit_amount_decimal: '2000', billing_scheme: 'per_unit',
    type: 'recurring', recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    custom_unit_amount: null, transform_quantity: null, tax_behavior: 'unspecified' }
  const price = { ...structuredClone(oldPrice), id: 'price_target', product: 'prod_target',
    active: true, unit_amount: 4000, unit_amount_decimal: '4000' }
  const subscription = {
    id: 'sub_fixture', livemode: false, customer: 'cus_fixture', status: 'active',
    pending_update: null, cancel_at: null, cancel_at_period_end: false, pause_collection: null,
    schedule: null, latest_invoice: 'in_paid', collection_method: 'charge_automatically',
    automatic_tax: { enabled: false }, discounts: [] as unknown[], default_tax_rates: [] as unknown[],
    pending_invoice_item_interval: null, trial_end: null,
    items: { has_more: false, data: [{ id: 'si_bound', quantity: 1, current_period_start: start,
      current_period_end: end, price: oldPrice, discounts: [] as unknown[], tax_rates: [] as unknown[],
      billing_thresholds: null }] },
  }
  const invoice = {
    id: 'in_paid', livemode: false, status: 'paid', customer: 'cus_fixture', currency: 'usd',
    amount_due: 2000, amount_paid: 2000, amount_remaining: 0, amount_paid_off_stripe: 0,
    billing_reason: 'subscription_cycle', subtotal: 2000, total: 2000,
    amount_shipping: 0, automatic_tax: { enabled: false }, default_tax_rates: [] as unknown[],
    total_pretax_credit_amounts: [] as unknown[],
    starting_balance: 0, ending_balance: 0, discounts: [] as unknown[],
    total_discount_amounts: [] as { amount: number }[], total_taxes: [] as { amount: number }[],
    pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
    parent: { subscription_details: { subscription: 'sub_fixture' } },
    lines: { has_more: false, data: [{ id: 'il_paid', livemode: false, currency: 'usd', quantity: 1,
      quantity_decimal: '1', amount: 2000, discounts: [], pretax_credit_amounts: [] as unknown[],
      discount_amounts: [], taxes: [], parent: { subscription_item_details: {
        subscription: 'sub_fixture', subscription_item: 'si_bound', proration: false } },
      pricing: { price_details: { price: 'price_old' } }, period: { start, end } }] },
    payments: { has_more: false, data: [{ invoice: 'in_paid', livemode: false, status: 'paid', amount_paid: 2000,
      payment: { type: 'payment_intent', payment_intent: 'pi_paid' } }] },
  }
  const line = (id: string, priceId: string, amount: number) => ({
    id, livemode: false, amount, subtotal: amount, currency: 'usd', quantity: 1, quantity_decimal: '1',
    discounts: [] as unknown[], discount_amounts: [] as { amount: number }[], taxes: [] as { amount: number }[],
    pretax_credit_amounts: [] as unknown[],
    parent: { type: 'subscription_item_details', subscription_item_details: {
      subscription: 'sub_fixture', subscription_item: 'si_bound', proration: true } },
    pricing: { type: 'price_details', price_details: { price: priceId } }, period: { start: now, end },
  })
  const preview = {
    id: 'upcoming_in_fixture', livemode: false, status: 'draft', customer: 'cus_fixture',
    currency: 'usd', amount_due: 1000, amount_paid: 0, amount_remaining: 1000,
    amount_shipping: 0, amount_paid_off_stripe: 0, subtotal: 1000, total: 1000,
    starting_balance: 0, ending_balance: 0, automatic_tax: { enabled: false },
    default_tax_rates: [] as unknown[], discounts: [] as unknown[],
    total_discount_amounts: [] as { amount: number }[], total_taxes: [] as { amount: number }[],
    total_pretax_credit_amounts: [] as unknown[], pre_payment_credit_notes_amount: 0,
    post_payment_credit_notes_amount: 0,
    parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_fixture' } },
    lines: { has_more: false, data: [line('il_credit', 'price_old', -1000), line('il_debit', 'price_target', 2000)] },
  }
  const intent = { id: 'pi_paid', livemode: false, customer: 'cus_fixture', currency: 'usd',
    status: 'succeeded', amount_received: 2000, latest_charge: 'ch_paid' }
  const charge = { id: 'ch_paid', livemode: false, customer: 'cus_fixture', currency: 'usd',
    payment_intent: 'pi_paid', status: 'succeeded', paid: true, captured: true,
    refunded: false, amount_refunded: 0, disputed: false, payment_method_details: { type: 'card' } }
  const port = {
    accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_fixture' }) },
    subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
    prices: { retrieve: vi.fn().mockResolvedValue(price) },
    invoices: { retrieve: vi.fn().mockResolvedValue(invoice),
      list: vi.fn().mockResolvedValue({ object: 'list', has_more: false, data: [] }),
      createPreview: vi.fn().mockResolvedValue(preview) },
    paymentIntents: { retrieve: vi.fn().mockResolvedValue(intent) },
    charges: { retrieve: vi.fn().mockResolvedValue(charge) },
  }
  const input = { binding: structuredClone(binding), target: structuredClone(target),
    lifecycle: { paidPeriodStart: iso(start), paidThrough: iso(end), lastPaidInvoiceId: 'in_paid' }, now: iso(now) }
  return { port, input, oldPrice, price, subscription, invoice, preview, intent, charge }
}
type Fixture = ReturnType<typeof fixture>

describe('read-only Stripe upgrade quote', () => {
  it('quotes signed provider credit and debit, preserving the paid term and archived purchased price', async () => {
    const f = fixture()
    const quote = await createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)
    expect(quote).toMatchObject({ binding, target, subscriptionItemId: 'si_bound', prorationDate: now,
      quotedAt: iso(now), paidPeriodStart: iso(start), paidThrough: iso(end), expiresAt: iso(now + 900),
      unusedCreditAmount: -1000, remainingChargeAmount: 2000, amountDue: 1000,
      currency: 'usd', nextRecurringAmount: 4000, paymentState: 'payment_required',
      lines: [{ kind: 'old_credit', priceId: 'price_old', amount: -1000 },
        { kind: 'target_debit', priceId: 'price_target', amount: 2000 }] })
    expect(UpgradeQuoteFactsSchema.parse(quote)).toEqual(quote)
    expect(f.port.paymentIntents.retrieve).toHaveBeenCalledWith('pi_paid')
    expect(f.port.charges.retrieve).toHaveBeenCalledWith('ch_paid')
    expect(f.port.invoices.createPreview).toHaveBeenCalledExactlyOnceWith({
      customer: 'cus_fixture', subscription: 'sub_fixture', preview_mode: 'next',
      subscription_details: { billing_cycle_anchor: 'unchanged', proration_behavior: 'always_invoice',
        proration_date: now, items: [{ id: 'si_bound', price: 'price_target', quantity: 1 }] },
    })
    expect(f.port.invoices.list).toHaveBeenCalledTimes(3)
    expect(Object.keys(quote)).not.toContain('customerEmail')
  })
  it('accepts provider rounding to zero as a zero-due quote without paid access', async () => {
    const f = fixture()
    f.preview.lines.data[0].amount = 0; f.preview.lines.data[0].subtotal = 0
    f.preview.lines.data[1].amount = 0; f.preview.lines.data[1].subtotal = 0
    f.preview.amount_due = 0; f.preview.amount_remaining = 0; f.preview.subtotal = 0; f.preview.total = 0
    const quote = await createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)
    expect(quote).toMatchObject({ amountDue: 0, paymentState: 'zero_due' })
    expect(quote).not.toHaveProperty('accessConfirmed')
  })
  it('accepts an unfinalized preview with null ending balance and zero starting balance', async () => {
    const f = fixture(); Object.assign(f.preview, { ending_balance: null })
    expect(await createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)).toMatchObject({ amountDue: 1000 })
  })
  it('bounds expiry by the existing paid-through timestamp', async () => {
    const f = fixture(); f.input.now = iso(end - 1)
    for (const line of f.preview.lines.data) line.period.start = end - 1
    expect(await createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)).toMatchObject({ expiresAt: iso(end) })
  })
  it.each([start, start + 1, end - 1])('preserves the original period at boundary %s', async timestamp => {
    const f = fixture(); f.input.now = iso(timestamp)
    for (const line of f.preview.lines.data) line.period.start = timestamp
    const quote = await createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)
    expect(quote).toMatchObject({ prorationDate: timestamp, paidPeriodStart: iso(start), paidThrough: iso(end) })
  })
  it('accepts annual-to-annual terms without resetting the paid renewal date', async () => {
    const f = fixture(); const annualEnd = start + 365 * 86400
    Object.assign(f.input.binding, { interval: 'year' }); Object.assign(f.input.target, { interval: 'year' })
    f.oldPrice.recurring.interval = 'year'; f.price.recurring.interval = 'year'
    f.subscription.items.data[0].current_period_end = annualEnd
    f.input.lifecycle.paidThrough = iso(annualEnd); f.invoice.lines.data[0].period.end = annualEnd
    for (const line of f.preview.lines.data) line.period.end = annualEnd
    const quote = await createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)
    expect(quote).toMatchObject({ paidThrough: iso(annualEnd), nextRecurringAmount: 4000 })
  })
  it('canonicalizes reversed preview lines and equivalent offset timestamps', async () => {
    const f = fixture(); f.preview.lines.data.reverse()
    f.input.lifecycle.paidThrough = '2026-10-31T20:00:00-04:00'
    const quote = await createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)
    expect(quote.lines.map(line => line.kind)).toEqual(['old_credit', 'target_debit'])
    expect(quote.paidThrough).toBe(iso(end))
  })
  const invalid: Array<[string, (f: Fixture) => void]> = [
    ['wrong account', f => f.port.accounts.retrieve.mockResolvedValue({ id: 'acct_other' })],
    ['wrong subscription', f => { f.subscription.id = 'sub_other' }],
    ['wrong customer', f => { f.subscription.customer = 'cus_other' }],
    ['live subscription', f => { f.subscription.livemode = true }],
    ['inactive subscription', f => { f.subscription.status = 'past_due' }],
    ['pending update', f => { Object.assign(f.subscription, { pending_update: {} }) }],
    ['cancellation', f => { f.subscription.cancel_at_period_end = true }],
    ['cancel timestamp', f => { Object.assign(f.subscription, { cancel_at: end }) }],
    ['pause', f => { Object.assign(f.subscription, { pause_collection: {} }) }],
    ['schedule', f => { Object.assign(f.subscription, { schedule: 'sub_sched_other' }) }],
    ['multiple items', f => { f.subscription.items.data.push(structuredClone(f.subscription.items.data[0])) }],
    ['incomplete items', f => { f.subscription.items.has_more = true }],
    ['multiple quantity', f => { f.subscription.items.data[0].quantity = 2 }],
    ['subscription discount', f => { f.subscription.discounts.push('di_discount') }],
    ['item discount', f => { f.subscription.items.data[0].discounts.push('di_discount') }],
    ['automatic tax', f => { f.subscription.automatic_tax.enabled = true }],
    ['tax rates', f => { f.subscription.default_tax_rates.push('txr_tax') }],
    ['item tax', f => { f.subscription.items.data[0].tax_rates.push('txr_tax') }],
    ['manual collection', f => { f.subscription.collection_method = 'send_invoice' }],
    ['unpaid latest invoice', f => { f.invoice.status = 'open' }],
    ['missing last paid identity', f => { f.input.lifecycle.lastPaidInvoiceId = 'in_other' }],
    ['paid-through mismatch', f => { f.input.lifecycle.paidThrough = iso(end + 1) }],
    ['paid-start mismatch', f => { f.input.lifecycle.paidPeriodStart = iso(start - 1) }],
    ['unpaid new period', f => { f.subscription.items.data[0].current_period_end = end + 86400 }],
    ['before paid term', f => { f.input.now = iso(start - 1) }],
    ['expired paid term', f => { f.input.now = iso(end) }],
    ['payment identity', f => { f.intent.customer = 'cus_other' }],
    ['refunded payment', f => { f.charge.refunded = true }],
    ['same tier price migration', f => { Object.assign(f.input.target, { plan_key: 'basic' }) }],
    ['downgrade', f => { Object.assign(f.input.binding, { plan_key: 'pro' }) }],
    ['target foreign account', f => { Object.assign(f.input.target, { stripe_account: 'acct_other' }) }],
    ['currency change', f => { Object.assign(f.input.target, { currency: 'cad' }) }],
    ['interval change', f => { Object.assign(f.input.target, { interval: 'year' }) }],
    ['cheaper upgrade', f => { Object.assign(f.input.target, { unit_amount: 1000 }) }],
    ['inactive target', f => { f.price.active = false }],
    ['wrong target price', f => { f.price.id = 'price_other' }],
    ['wrong target product', f => { f.price.product = 'prod_other' }],
    ['wrong target amount', f => { f.price.unit_amount = 4001 }],
    ['target decimal amount', f => { f.price.unit_amount_decimal = '4000.1' }],
    ['metered target', f => { f.price.recurring.usage_type = 'metered' }],
    ['target quantity transformation', f => { Object.assign(f.price, { transform_quantity: { divide_by: 2 } }) }],
    ['truncated paid lines', f => { f.invoice.lines.has_more = true }],
    ['unsafe paid amount', f => { f.invoice.amount_paid = Number.MAX_SAFE_INTEGER + 1 }],
    ['paid invoice pretax credits', f => { f.invoice.total_pretax_credit_amounts.push({ amount: 1 }) }],
    ['paid line pretax credits', f => { f.invoice.lines.data[0].pretax_credit_amounts.push({ amount: 1 }) }],
    ['paid invoice shipping', f => { f.invoice.amount_shipping = 1 }],
    ['paid invoice hidden automatic tax', f => { f.invoice.automatic_tax.enabled = true }],
    ['paid line foreign currency', f => { f.invoice.lines.data[0].currency = 'cad' }],
    ['paid line fractional quantity', f => { f.invoice.lines.data[0].quantity_decimal = '1.5' }],
  ]
  it.each(invalid)('rejects %s before requesting a quote', async (_label, mutate) => {
    const f = fixture(); mutate(f)
    await expect(createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)).rejects.toBeInstanceOf(UpgradeQuoteContractError)
    expect(f.port.invoices.createPreview).not.toHaveBeenCalled()
  })
  it.each(['draft', 'open', 'uncollectible'])('rejects an outstanding %s invoice', async status => {
    const f = fixture()
    f.port.invoices.list.mockImplementation(async input => ({ object: 'list', has_more: false,
      data: input.status === status ? [{ id: 'in_unpaid' }] : [] }))
    await expect(createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)).rejects.toBeInstanceOf(UpgradeQuoteContractError)
    expect(f.port.invoices.createPreview).not.toHaveBeenCalled()
  })
  it('rejects incomplete outstanding invoice enumeration', async () => {
    const f = fixture(); f.port.invoices.list.mockResolvedValue({ object: 'list', has_more: true, data: [] })
    await expect(createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)).rejects.toBeInstanceOf(UpgradeQuoteContractError)
  })
  const badPreview: Array<[string, (f: Fixture) => void]> = [
    ['preview account mode', f => { f.preview.livemode = true }],
    ['preview customer', f => { f.preview.customer = 'cus_other' }],
    ['preview subscription', f => { f.preview.parent.subscription_details.subscription = 'sub_other' }],
    ['preview currency', f => { f.preview.currency = 'cad' }],
    ['preview lines truncated', f => { f.preview.lines.has_more = true }],
    ['unrelated line', f => { f.preview.lines.data.push(structuredClone(f.preview.lines.data[1])) }],
    ['wrong line price', f => { f.preview.lines.data[0].pricing.price_details.price = 'price_other' }],
    ['wrong line currency', f => { f.preview.lines.data[0].currency = 'cad' }],
    ['wrong item identity', f => { f.preview.lines.data[0].parent.subscription_item_details.subscription_item = 'si_other' }],
    ['non-proration', f => { f.preview.lines.data[0].parent.subscription_item_details.proration = false }],
    ['quantity', f => { f.preview.lines.data[0].quantity = 2 }],
    ['decimal quantity', f => { f.preview.lines.data[0].quantity_decimal = '1.1' }],
    ['wrong period start', f => { f.preview.lines.data[0].period.start += 1 }],
    ['cross-period end', f => { f.preview.lines.data[0].period.end += 1 }],
    ['positive old credit', f => { f.preview.lines.data[0].amount = 1000 }],
    ['negative target debit', f => { f.preview.lines.data[1].amount = -2000 }],
    ['wrong amount due', f => { f.preview.amount_due += 1 }],
    ['wrong subtotal', f => { f.preview.subtotal += 1 }],
    ['wrong total', f => { f.preview.total += 1 }],
    ['unsafe line amount', f => { f.preview.lines.data[1].amount = Number.MAX_SAFE_INTEGER + 1 }],
    ['balance credit', f => { f.preview.starting_balance = -1 }],
    ['ending balance', f => { f.preview.ending_balance = 1 }],
    ['discount', f => { f.preview.discounts.push('di_discount') }],
    ['zero-valued discount', f => { f.preview.total_discount_amounts.push({ amount: 0 }) }],
    ['tax', f => { f.preview.total_taxes.push({ amount: 1 }) }],
    ['zero-valued line tax', f => { f.preview.lines.data[0].taxes.push({ amount: 0 }) }],
    ['pretax credit', f => { f.preview.total_pretax_credit_amounts.push({ amount: 1 }) }],
    ['line pretax credit', f => { f.preview.lines.data[0].pretax_credit_amounts.push({ amount: 1 }) }],
    ['credit note', f => { f.preview.post_payment_credit_notes_amount = 1 }],
    ['shipping', f => { f.preview.amount_shipping = 1 }],
    ['paid preview', f => { f.preview.amount_paid = 1 }],
    ['live line', f => { f.preview.lines.data[0].livemode = true }],
    ['line subtotal', f => { f.preview.lines.data[0].subtotal = 0 }],
  ]
  it.each(badPreview)('rejects %s without returning quote facts', async (_label, mutate) => {
    const f = fixture(); mutate(f)
    await expect(createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)).rejects.toBeInstanceOf(UpgradeQuoteContractError)
  })
  it('propagates provider outages for retry without leaking raw failures as contract errors', async () => {
    const f = fixture(); f.port.invoices.createPreview.mockRejectedValue(new Error('provider unavailable'))
    await expect(createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)).rejects.toThrow('provider unavailable')
  })
  it('invalidates modified canonical quote amount and frozen period facts', async () => {
    const f = fixture(); const quote = await createStripeUpgradeQuoteProvider(f.port).prepareQuote(f.input)
    expect(UpgradeQuoteFactsSchema.safeParse({ ...quote, amountDue: 999 }).success).toBe(false)
    expect(UpgradeQuoteFactsSchema.safeParse({ ...quote, expiresAt: iso(end + 1) }).success).toBe(false)
    expect(UpgradeQuoteFactsSchema.safeParse({ ...quote, paymentState: 'zero_due' }).success).toBe(false)
  })
  it('uses only pinned SDK read and preview methods with required payment expansion', async () => {
    const stripe = new Stripe('sk_test_fixture', { apiVersion: '2026-08-26.dahlia' })
    const account = vi.spyOn(stripe.accounts, 'retrieve').mockResolvedValue({} as never)
    const subscription = vi.spyOn(stripe.subscriptions, 'retrieve').mockResolvedValue({} as never)
    const price = vi.spyOn(stripe.prices, 'retrieve').mockResolvedValue({} as never)
    const invoice = vi.spyOn(stripe.invoices, 'retrieve').mockResolvedValue({} as never)
    const list = vi.spyOn(stripe.invoices, 'list').mockResolvedValue({} as never)
    const preview = vi.spyOn(stripe.invoices, 'createPreview').mockResolvedValue({} as never)
    const port = createStripeUpgradeQuotePort(stripe)
    await port.accounts.retrieve(); await port.subscriptions.retrieve('sub_fixture')
    await port.prices.retrieve('price_target'); await port.invoices.retrieve('in_paid')
    await port.invoices.list({ subscription: 'sub_fixture', status: 'open', limit: 1 })
    await port.invoices.createPreview({ subscription: 'sub_fixture' })
    expect(account).toHaveBeenCalledWith(null)
    expect(subscription).toHaveBeenCalledWith('sub_fixture')
    expect(price).toHaveBeenCalledWith('price_target')
    expect(invoice).toHaveBeenCalledWith('in_paid', { expand: ['payments'] })
    expect(list).toHaveBeenCalledWith({ subscription: 'sub_fixture', status: 'open', limit: 1 })
    expect(preview).toHaveBeenCalledWith({ subscription: 'sub_fixture' })
  })
})
