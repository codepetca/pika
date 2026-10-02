import { describe, expect, it, vi } from 'vitest'
import { createStripeCloseoutProvider } from '@/lib/server/billing/stripe-closeout-provider'

const binding = {
  subscription_id: '11111111-1111-4111-8111-111111111111',
  subject_user_id: '22222222-2222-4222-8222-222222222222',
  offering_id: '33333333-3333-4333-8333-333333333333',
  offering_version_id: '44444444-4444-4444-8444-444444444444',
  stripe_account: 'acct_fixture', stripe_customer_id: 'cus_fixture',
  stripe_subscription_id: 'sub_fixture', stripe_price_id: 'price_fixture',
  stripe_product_id: 'prod_fixture', unit_amount: 2000,
  plan_key: 'plus', currency: 'usd', interval: 'month', provider_mode: 'test',
} as const
const request = { binding, invoiceId: 'in_fixture', paidThrough: '2026-10-01T00:00:00.000Z', cutoff: '2026-10-08T00:00:00.000Z' }
const mutationRequest = { ...request, beforeMutation: async () => true }
const write = { ...mutationRequest, idempotencyKey: 'closeout-fixture-pause' }
function fixture() {
  const subscription = {
    id: 'sub_fixture', livemode: false, customer: 'cus_fixture', status: 'past_due',
    pending_update: null, cancel_at: null, cancel_at_period_end: false,
    pause_collection: null, schedule: null, latest_invoice: 'in_fixture',
    items: { has_more: false, data: [{ quantity: 1,
      current_period_start: 1790812800, current_period_end: 1793491200,
      price: { id: 'price_fixture', livemode: false, currency: 'usd',
        product: 'prod_fixture', unit_amount: 2000,
        recurring: { interval: 'month', interval_count: 1 } },
    }] },
  }
  const invoice = {
    id: 'in_fixture', livemode: false, status: 'open', customer: 'cus_fixture',
    auto_advance: true, currency: 'usd', amount_due: 2000, amount_paid: 0, amount_remaining: 2000,
    amount_paid_off_stripe: 0, billing_reason: 'subscription_cycle', subtotal: 2000, total: 2000,
    starting_balance: 0, ending_balance: 0, discounts: [] as string[],
    total_discount_amounts: [] as { amount: number }[], total_taxes: [] as { amount: number }[],
    pre_payment_credit_notes_amount: 0, post_payment_credit_notes_amount: 0,
    parent: { subscription_details: { subscription: 'sub_fixture' } },
    lines: { has_more: false, data: [{ quantity: 1, amount: 2000,
      discounts: [], discount_amounts: [], taxes: [],
      parent: { subscription_item_details: { subscription: 'sub_fixture', proration: false } },
      pricing: { price_details: { price: 'price_fixture' } },
      period: { start: 1790812800, end: 1793491200 },
    }] },
    payments: { has_more: false, data: [{ invoice: 'in_fixture', livemode: false,
      status: 'open', amount_paid: null as number | null, amount_requested: 2000, currency: 'usd',
      payment: { type: 'payment_intent', payment_intent: 'pi_fixture' },
    }] },
  }
  const intent = { id: 'pi_fixture', livemode: false, customer: 'cus_fixture',
    currency: 'usd', status: 'requires_payment_method', amount: 2000, amount_received: 0,
    amount_capturable: 0, latest_charge: null as string | null, payment_method_types: ['card'] }
  const charge = { id: 'ch_fixture', livemode: false, customer: 'cus_fixture',
    currency: 'usd', payment_intent: 'pi_fixture', captured: false, paid: false,
    refunded: false, amount_refunded: 0, disputed: false, status: 'failed', amount: 2000, amount_captured: 0,
    payment_method_details: { type: 'card' } }
  const sdk = {
    accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_fixture' }) },
    subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription), cancel: vi.fn().mockResolvedValue({}) },
    invoices: {
      retrieve: vi.fn().mockResolvedValue(invoice),
      list: vi.fn().mockImplementation(async input => ({ object: 'list', has_more: false,
        data: input.status === invoice.status ? [invoice] : [] })),
      update: vi.fn().mockResolvedValue({}), voidInvoice: vi.fn().mockResolvedValue({}),
    },
    paymentIntents: { retrieve: vi.fn().mockResolvedValue(intent) },
    charges: { retrieve: vi.fn().mockResolvedValue(charge) },
  }
  return { sdk, subscription, invoice, intent, charge, provider: createStripeCloseoutProvider(sdk) }
}
function paid(f: ReturnType<typeof fixture>) {
  f.subscription.status = 'active'; f.invoice.status = 'paid'; f.invoice.amount_paid = 2000
  f.invoice.amount_remaining = 0; f.invoice.payments.data[0].status = 'paid'
  f.invoice.payments.data[0].amount_paid = 2000; f.intent.status = 'succeeded'
  f.intent.amount_received = 2000; f.intent.latest_charge = 'ch_fixture'
  f.charge.status = 'succeeded'; f.charge.paid = true; f.charge.captured = true; f.charge.amount_captured = 2000
}
function voided(f: ReturnType<typeof fixture>) {
  f.invoice.status = 'void'; f.invoice.amount_remaining = 0; f.invoice.auto_advance = false
  f.invoice.payments.data[0].status = 'canceled'; f.intent.status = 'canceled'
}

describe('Stripe renewal closeout adapter', () => {
  it('recognizes a bound failed renewal only after reading its raw unpaid intent', async () => {
    const f = fixture()
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toEqual({ kind: 'unpaid', invoiceId: 'in_fixture', invoiceStatus: 'open', collectionPaused: false })
    expect(f.sdk.paymentIntents.retrieve).toHaveBeenCalledWith('pi_fixture')
    expect(f.sdk.invoices.list).toHaveBeenCalledTimes(3)
  })
  it.each(['processing', 'requires_action', 'requires_confirmation', 'requires_capture', 'succeeded'])('defers a %s intent despite an unpaid invoice', async status => {
    const f = fixture(); f.intent.status = status
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'payment_pending' })
    await f.provider.pauseInvoiceCollection(write); await f.provider.voidInvoice(write)
    expect(f.sdk.invoices.update).not.toHaveBeenCalled(); expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })
  it.each(['active', 'canceled'])('returns strictly verified paid renewal evidence for %s', async status => {
    const f = fixture(); paid(f); f.subscription.status = status
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'paid', invoiceId: 'in_fixture', periodStart: request.paidThrough, providerStatus: status })
  })
  it.each([
    ['account', (f: ReturnType<typeof fixture>) => { f.sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_other' }) }],
    ['customer', (f: ReturnType<typeof fixture>) => { f.subscription.customer = 'cus_other' }],
    ['price', (f: ReturnType<typeof fixture>) => { f.subscription.items.data[0].price.id = 'price_other' }],
    ['product', (f: ReturnType<typeof fixture>) => { f.subscription.items.data[0].price.product = 'prod_other' }],
    ['currency', (f: ReturnType<typeof fixture>) => { f.invoice.currency = 'cad' }],
    ['amount', (f: ReturnType<typeof fixture>) => { f.invoice.total = 2001 }],
    ['proration', (f: ReturnType<typeof fixture>) => { f.invoice.lines.data[0].parent.subscription_item_details.proration = true }],
    ['period', (f: ReturnType<typeof fixture>) => { f.invoice.lines.data[0].period.start++ }],
    ['later invoice', (f: ReturnType<typeof fixture>) => { f.subscription.latest_invoice = 'in_later' }],
    ['live intent', (f: ReturnType<typeof fixture>) => { f.intent.livemode = true }],
    ['foreign intent', (f: ReturnType<typeof fixture>) => { f.intent.customer = 'cus_other' }],
    ['intent amount', (f: ReturnType<typeof fixture>) => { f.intent.amount = 2001 }],
    ['partial payment', (f: ReturnType<typeof fixture>) => { f.intent.amount_received = 1 }],
    ['authorization', (f: ReturnType<typeof fixture>) => { f.intent.amount_capturable = 2000 }],
    ['out of band', (f: ReturnType<typeof fixture>) => { f.invoice.amount_paid_off_stripe = 2000 }],
    ['unsupported payment', (f: ReturnType<typeof fixture>) => { f.invoice.payments.data[0].payment.type = 'payment_record' }],
    ['truncated payments', (f: ReturnType<typeof fixture>) => { f.invoice.payments.has_more = true }],
    ['truncated lines', (f: ReturnType<typeof fixture>) => { f.invoice.lines.has_more = true }],
    ['future obligations', (f: ReturnType<typeof fixture>) => { f.sdk.invoices.list.mockResolvedValue({ object: 'list', has_more: false, data: [{ id: 'in_later' }] }) }],
    ['truncated obligations', (f: ReturnType<typeof fixture>) => { f.sdk.invoices.list.mockResolvedValue({ object: 'list', has_more: true, data: [] }) }],
  ] as const)('fails closed for %s and never mutates', async (_label, mutate) => {
    const f = fixture(); mutate(f)
    const evidence = await f.provider.readCloseoutEvidence(request)
    expect(['attention', 'payment_pending']).toContain(evidence.kind)
    await f.provider.pauseInvoiceCollection(write); await f.provider.voidInvoice(write); await f.provider.cancelSubscription(mutationRequest)
    expect(f.sdk.invoices.update).not.toHaveBeenCalled(); expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled(); expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })
  it.each(['refunded', 'disputed', 'non-card'])('rejects %s paid proof', async kind => {
    const f = fixture(); paid(f)
    if (kind === 'refunded') f.charge.amount_refunded = 1
    if (kind === 'disputed') f.charge.disputed = true
    if (kind === 'non-card') f.charge.payment_method_details.type = 'us_bank_account'
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'attention' })
  })
  it('pauses with the stable POST key only after a fresh read and does not repeat an observed pause', async () => {
    const f = fixture()
    await f.provider.pauseInvoiceCollection(write)
    expect(f.sdk.invoices.update).toHaveBeenCalledWith('in_fixture', { auto_advance: false }, { idempotencyKey: write.idempotencyKey })
    f.invoice.auto_advance = false
    await f.provider.pauseInvoiceCollection(write)
    expect(f.sdk.invoices.update).toHaveBeenCalledTimes(1)
  })
  it('requires a confirmed pause before voiding, with a stable POST key', async () => {
    const f = fixture(); await f.provider.voidInvoice(write)
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
    f.invoice.auto_advance = false; await f.provider.voidInvoice(write)
    expect(f.sdk.invoices.voidInvoice).toHaveBeenCalledWith('in_fixture', {}, { idempotencyKey: write.idempotencyKey })
  })
  it('rereads payment state before void so a paid race wins', async () => {
    const f = fixture(); f.invoice.auto_advance = false
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'unpaid' })
    paid(f); await f.provider.voidInvoice(write)
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })
  it('cancels only a verified void with cleared obligations and no DELETE idempotency key', async () => {
    const f = fixture(); await f.provider.cancelSubscription(mutationRequest)
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
    voided(f); await f.provider.cancelSubscription(mutationRequest)
    expect(f.sdk.subscriptions.cancel).toHaveBeenCalledWith('sub_fixture', { invoice_now: false, prorate: false })
    f.subscription.status = 'canceled'; await f.provider.cancelSubscription(mutationRequest)
    expect(f.sdk.subscriptions.cancel).toHaveBeenCalledTimes(1)
  })
  it('rejects a void whose raw intent still has an in-flight payment', async () => {
    const f = fixture(); voided(f); f.intent.status = 'processing'
    await f.provider.cancelSubscription(mutationRequest)
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })
  it('checks latest failed charge even when no invoice payment has been made', async () => {
    const f = fixture(); f.intent.latest_charge = 'ch_fixture'; f.charge.disputed = true
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'attention' })
    expect(f.sdk.charges.retrieve).toHaveBeenCalledWith('ch_fixture')
  })
  it('does not erase captured money hidden behind inconsistent failed charge flags', async () => {
    const f = fixture(); f.intent.latest_charge = 'ch_fixture'; f.charge.amount_captured = 1
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'attention' })
    await f.provider.voidInvoice(write)
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })
  it('does not accept a paid charge whose captured amount is short', async () => {
    const f = fixture(); paid(f); f.charge.amount_captured = 1999
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'attention' })
  })
  it('does not accept paid proof with an outstanding authorization', async () => {
    const f = fixture(); paid(f); f.intent.amount_capturable = 1
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'attention' })
  })
  it('rejects a void whose intent is still payable', async () => {
    const f = fixture(); voided(f); f.intent.status = 'requires_payment_method'
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'attention' })
    await f.provider.cancelSubscription(mutationRequest)
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })
  it('reconciles an ambiguous cancel against current provider status before retrying', async () => {
    const f = fixture(); voided(f)
    f.sdk.subscriptions.cancel.mockImplementation(async () => { f.subscription.status = 'canceled'; throw new Error('lost cancel response') })
    await expect(f.provider.cancelSubscription(mutationRequest)).rejects.toThrow('lost cancel response')
    await f.provider.cancelSubscription(mutationRequest)
    expect(f.sdk.subscriptions.cancel).toHaveBeenCalledTimes(1)
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'invoice_voided', subscriptionCanceled: true, obligationsCleared: true })
  })
  it('reconciles an ambiguous void against invoice status without repeating POST', async () => {
    const f = fixture(); f.invoice.auto_advance = false
    f.sdk.invoices.voidInvoice.mockImplementation(async () => { voided(f); throw new Error('lost void response') })
    await expect(f.provider.voidInvoice(write)).rejects.toThrow('lost void response')
    await f.provider.voidInvoice(write)
    expect(f.sdk.invoices.voidInvoice).toHaveBeenCalledTimes(1)
  })
  it('does not treat a normalized empty unpaid payment collection as absent raw intents', async () => {
    const f = fixture(); f.invoice.auto_advance = false; f.intent.status = 'processing'
    await f.provider.voidInvoice(write)
    expect(f.sdk.paymentIntents.retrieve).toHaveBeenCalledWith('pi_fixture')
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })
  it.each(['pause', 'void', 'cancel'] as const)('checks the fresh evidence before the %s database fence', async stage => {
    const f = fixture()
    if (stage === 'void') f.invoice.auto_advance = false
    if (stage === 'cancel') voided(f)
    const beforeMutation = vi.fn(async () => {
      expect(f.sdk.paymentIntents.retrieve).toHaveBeenCalledWith('pi_fixture')
      expect(f.sdk.invoices.list).toHaveBeenCalledTimes(3)
      expect(f.sdk.invoices.update).not.toHaveBeenCalled()
      expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
      expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
      return true
    })
    const fenced = { ...write, beforeMutation }
    if (stage === 'pause') await f.provider.pauseInvoiceCollection(fenced)
    if (stage === 'void') await f.provider.voidInvoice(fenced)
    if (stage === 'cancel') await f.provider.cancelSubscription(fenced)
    expect(beforeMutation).toHaveBeenCalledTimes(1)
    expect(f.sdk.invoices.update.mock.calls.length + f.sdk.invoices.voidInvoice.mock.calls.length + f.sdk.subscriptions.cancel.mock.calls.length).toBe(1)
  })
  it.each(['pause', 'void', 'cancel'] as const)('never performs %s if the database fence is lost', async stage => {
    const f = fixture()
    if (stage === 'void') f.invoice.auto_advance = false
    if (stage === 'cancel') voided(f)
    const fenced = { ...write, beforeMutation: vi.fn().mockResolvedValue(false) }
    if (stage === 'pause') await f.provider.pauseInvoiceCollection(fenced)
    if (stage === 'void') await f.provider.voidInvoice(fenced)
    if (stage === 'cancel') await f.provider.cancelSubscription(fenced)
    expect(f.sdk.invoices.update).not.toHaveBeenCalled()
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })
  it.each(['pause', 'void', 'cancel'] as const)('never performs %s if the database fence request fails', async stage => {
    const f = fixture()
    if (stage === 'void') f.invoice.auto_advance = false
    if (stage === 'cancel') voided(f)
    const fenced = { ...write, beforeMutation: vi.fn().mockRejectedValue(new Error('fence unavailable')) }
    const operation = stage === 'pause' ? f.provider.pauseInvoiceCollection(fenced)
      : stage === 'void' ? f.provider.voidInvoice(fenced) : f.provider.cancelSubscription(fenced)
    await expect(operation).rejects.toThrow('fence unavailable')
    expect(f.sdk.invoices.update).not.toHaveBeenCalled()
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })
  it('pins the mutation target before asynchronous SDK observations', async () => {
    const f = fixture(); const mutable = { ...write, binding: { ...binding } }
    f.sdk.accounts.retrieve.mockImplementation(async () => {
      mutable.invoiceId = 'in_foreign'; mutable.binding.stripe_subscription_id = 'sub_foreign'
      mutable.idempotencyKey = 'changed-key'
      return { id: 'acct_fixture' }
    })
    await f.provider.pauseInvoiceCollection(mutable)
    expect(f.sdk.invoices.update).toHaveBeenCalledWith('in_fixture', { auto_advance: false }, { idempotencyKey: write.idempotencyKey })
  })
  it('requires exactly seven elapsed days between paid-through and cutoff', async () => {
    const f = fixture()
    await expect(f.provider.readCloseoutEvidence({ ...request, cutoff: request.paidThrough })).resolves.toMatchObject({ kind: 'attention' })
    expect(f.sdk.accounts.retrieve).not.toHaveBeenCalled()
  })
  it('propagates write failures without assuming a mutation failed', async () => {
    const f = fixture(); f.sdk.invoices.update.mockRejectedValue(new Error('ambiguous transport'))
    await expect(f.provider.pauseInvoiceCollection(write)).rejects.toThrow('ambiguous transport')
  })
  it('propagates read outages for retry', async () => {
    const f = fixture(); f.sdk.paymentIntents.retrieve.mockRejectedValue(new Error('read outage'))
    await expect(f.provider.readCloseoutEvidence(request)).rejects.toThrow('read outage')
  })
})
