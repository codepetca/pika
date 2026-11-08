import { describe, expect, it, vi } from 'vitest'
import { createStripeCloseoutProvider, verifyInstalledStripeSchedule } from '@/lib/server/billing/stripe-closeout-provider'
import type { RenewalCloseoutWriteRequest } from '@/lib/server/billing/closeout-contracts'
import { BillingProviderSubscriptionSnapshotSchema } from '@/lib/server/billing/contracts'
import { createStripeBillingProvider } from '@/lib/server/billing/stripe-provider'

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
    pending_update: null, cancel_at: null as number | null, cancel_at_period_end: false,
    pause_collection: null, schedule: null as string | null, latest_invoice: 'in_fixture',
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

const scheduledRequest = {
  ...request,
  binding: { ...binding, offering_version_id: '55555555-5555-4555-8555-555555555555',
    stripe_price_id: 'price_Max', stripe_product_id: 'prod_Max', unit_amount: 5000, plan_key: 'pro' as const },
  scheduled: {
    operation_id: '66666666-6666-4666-8666-666666666666',
    provider_schedule_id: 'sub_sched_Pika',
    effective_at: request.paidThrough,
    target_binding: binding,
  },
}

function scheduledFixture() {
  const f = fixture()
  const id = scheduledRequest.scheduled.provider_schedule_id
  f.subscription.schedule = id
  f.invoice.billing_reason = 'subscription_update'
  const schedule = {
    id, object: 'subscription_schedule', livemode: false, customer: binding.stripe_customer_id as string,
    subscription: binding.stripe_subscription_id as string | null, status: 'active',
    metadata: { pika_plan_change_operation: scheduledRequest.scheduled.operation_id },
    end_behavior: 'release', canceled_at: null as number | null,
    current_phase: { start_date: 1790812800, end_date: 1793491200 } as { start_date: number; end_date: number } | null,
    phases: [{ start_date: 1790812800, end_date: 1793491200, currency: 'usd', proration_behavior: 'none',
      items: [{ price: 'price_fixture', quantity: 1 }] }],
  }
  const sdk = {
    ...f.sdk, retrieveSchedule: vi.fn().mockResolvedValue(schedule), cancelSchedule: vi.fn().mockResolvedValue({}),
  }
  const provider = createStripeCloseoutProvider(sdk)
  const beforeMutation = vi.fn(async () => true)
  const close = { ...scheduledRequest, beforeMutation, idempotencyKey: 'closeout-fixture:cancel' }
  function canceled() {
    f.subscription.status = 'canceled'
    f.subscription.schedule = null
    schedule.status = 'canceled'
    schedule.subscription = null
    schedule.canceled_at = 1791417600
    schedule.current_phase = null
  }
  return { ...f, sdk, schedule, provider, close, beforeMutation, canceled }
}

const liveScope = { stripeAccount: binding.stripe_account, providerMode: 'live' } as const
const liveRequest = { ...request, binding: { ...binding, provider_mode: 'live' as const } }

function liveFixture() {
  const f = fixture()
  f.subscription.livemode = true
  f.subscription.items.data[0].price.livemode = true
  f.invoice.livemode = true
  f.invoice.payments.data[0].livemode = true
  f.intent.livemode = true
  f.charge.livemode = true
  const sdk = { ...f.sdk, invoices: { ...f.sdk.invoices,
    listCustomer: vi.fn().mockResolvedValue({ object: 'list', has_more: false, data: [] }),
  } }
  return { ...f, sdk, provider: createStripeCloseoutProvider(sdk, liveScope) }
}

describe('live Stripe renewal closeout scope', () => {
  it('requires the explicit matching scope and rejects live scheduled proof before Stripe reads', async () => {
    const f = liveFixture()
    const foreign = createStripeCloseoutProvider(f.sdk, { ...liveScope, stripeAccount: 'acct_other' })
    await expect(createStripeCloseoutProvider(f.sdk).readCloseoutEvidence(liveRequest))
      .resolves.toEqual({ kind: 'attention', reason: 'identity_mismatch' })
    await expect(f.provider.readCloseoutEvidence(request)).resolves.toEqual({ kind: 'attention', reason: 'identity_mismatch' })
    await expect(foreign.readCloseoutEvidence(liveRequest)).resolves.toEqual({ kind: 'attention', reason: 'identity_mismatch' })
    await expect(f.provider.readCloseoutEvidence({ ...liveRequest, scheduled: scheduledRequest.scheduled }))
      .resolves.toEqual({ kind: 'attention', reason: 'identity_mismatch' })
    expect(f.sdk.accounts.retrieve).not.toHaveBeenCalled()
  })

  it('checks the current account before reading a live financial object', async () => {
    const f = liveFixture()
    f.sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_other' })
    await expect(f.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({ kind: 'attention' })
    expect(f.sdk.subscriptions.retrieve).not.toHaveBeenCalled()
    expect(f.sdk.invoices.retrieve).not.toHaveBeenCalled()
    expect(f.sdk.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(f.sdk.charges.retrieve).not.toHaveBeenCalled()
  })

  it('verifies live unpaid, pending, captured and terminal void evidence', async () => {
    const f = liveFixture()
    await expect(f.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({ kind: 'unpaid', collectionPaused: false })
    f.intent.status = 'processing'
    await expect(f.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({ kind: 'payment_pending' })
    paid(f)
    await expect(f.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({ kind: 'paid', invoiceId: request.invoiceId })
    const terminal = liveFixture()
    voided(terminal)
    terminal.subscription.status = 'canceled'
    await expect(terminal.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({
      kind: 'invoice_voided', subscriptionCanceled: true, obligationsCleared: true,
    })
    expect(terminal.sdk.invoices.listCustomer).not.toHaveBeenCalled()
  })

  it.each(['subscription', 'price', 'invoice', 'invoicePayment', 'intent', 'charge'] as const)(
    'rejects missing or sandbox mode on live %s evidence',
    async object => {
      for (const livemode of [false, undefined]) {
        const f = liveFixture()
        paid(f)
        const evidence = {
          subscription: f.subscription, price: f.subscription.items.data[0].price, invoice: f.invoice,
          invoicePayment: f.invoice.payments.data[0], intent: f.intent, charge: f.charge,
        }
        Object.assign(evidence[object], { livemode })
        await expect(f.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({ kind: 'attention' })
      }
    },
  )

  it.each(['processing', 'canceled'] as const)('rejects foreign live mode on a %s intent before any write', async status => {
    const f = liveFixture()
    if (status === 'canceled') voided(f)
    f.intent.status = status
    f.intent.livemode = false
    const beforeMutation = vi.fn().mockResolvedValue(true)
    const guarded = { ...liveRequest, beforeMutation, idempotencyKey: 'closeout-live-fixture' }
    await expect(f.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({ kind: 'attention' })
    await f.provider.pauseInvoiceCollection(guarded)
    await f.provider.voidInvoice(guarded)
    await f.provider.cancelSubscription(guarded)
    expect(beforeMutation).not.toHaveBeenCalled()
    expect(f.sdk.invoices.update).not.toHaveBeenCalled()
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('checks terminal obligation mode without treating a complete payment as proof of clearance', async () => {
    const f = liveFixture()
    paid(f)
    f.subscription.status = 'canceled'
    const another = { ...f.invoice, id: 'in_other', status: 'open', livemode: false }
    f.sdk.invoices.list.mockImplementation(async ({ status }) => ({
      object: 'list', has_more: status === 'open', data: status === 'open' ? [another] : [],
    }))
    await expect(f.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({ kind: 'attention' })
    another.livemode = true
    await expect(f.provider.readCloseoutEvidence(liveRequest)).resolves.toMatchObject({ kind: 'paid', terminalObligationsCleared: false })
  })

  it('blocks live cancellation when another customer invoice is outstanding or proof is missing', async () => {
    const f = liveFixture()
    voided(f)
    f.sdk.invoices.listCustomer.mockResolvedValue({ object: 'list', has_more: false, data: [{ id: 'in_other' }] })
    const beforeMutation = vi.fn().mockResolvedValue(true)
    const guarded = { ...liveRequest, beforeMutation }
    await f.provider.cancelSubscription(guarded)
    await createStripeCloseoutProvider({ ...f.sdk, invoices: { ...f.sdk.invoices, listCustomer: undefined } }, liveScope)
      .cancelSubscription(guarded)
    expect(beforeMutation).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it.each([true, false])('checks the live cancellation scope and lease immediately before DELETE (%s)', async allowed => {
    const f = liveFixture()
    voided(f)
    const beforeMutation = vi.fn(async () => {
      expect(f.sdk.invoices.listCustomer).toHaveBeenNthCalledWith(1, { customer: binding.stripe_customer_id, status: 'open', limit: 1 })
      expect(f.sdk.invoices.listCustomer).toHaveBeenNthCalledWith(2, { customer: binding.stripe_customer_id, status: 'uncollectible', limit: 1 })
      expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
      return allowed
    })
    await f.provider.cancelSubscription({ ...liveRequest, beforeMutation })
    expect(beforeMutation).toHaveBeenCalledOnce()
    if (allowed) expect(f.sdk.subscriptions.cancel).toHaveBeenCalledExactlyOnceWith(binding.stripe_subscription_id, {
      invoice_now: false, prorate: false,
    })
    else expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })
})

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
    const f = fixture(); const mutable: RenewalCloseoutWriteRequest = { ...write, binding: { ...binding } }
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

describe('Stripe closeout of an installed scheduled renewal', () => {
  it('keeps legacy subscription updates outside closeout and accepts a verified scheduled cycle', async () => {
    const ordinary = fixture()
    ordinary.invoice.billing_reason = 'subscription_update'
    await expect(ordinary.provider.readCloseoutEvidence(request)).resolves.toMatchObject({ kind: 'attention' })
    await ordinary.provider.pauseInvoiceCollection(write)
    expect(ordinary.sdk.invoices.update).not.toHaveBeenCalled()
    const scheduled = scheduledFixture()
    scheduled.invoice.billing_reason = 'subscription_cycle'
    await expect(scheduled.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({ kind: 'unpaid' })
  })

  it('uses the Pro invoice terms while the persisted access binding still identifies Max', async () => {
    const f = scheduledFixture()
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toEqual({
      kind: 'unpaid', invoiceId: request.invoiceId, invoiceStatus: 'open', collectionPaused: false,
    })
    expect(f.sdk.retrieveSchedule).toHaveBeenCalledExactlyOnceWith(scheduledRequest.scheduled.provider_schedule_id)
    await f.provider.pauseInvoiceCollection({ ...f.close, idempotencyKey: 'closeout-fixture:pause' })
    expect(f.sdk.invoices.update).toHaveBeenCalledWith(request.invoiceId, { auto_advance: false },
      { idempotencyKey: 'closeout-fixture:pause' })
    f.invoice.auto_advance = false
    await f.provider.voidInvoice({ ...f.close, idempotencyKey: 'closeout-fixture:void' })
    expect(f.sdk.invoices.voidInvoice).toHaveBeenCalledWith(request.invoiceId, {}, { idempotencyKey: 'closeout-fixture:void' })
    expect(f.sdk.cancelSchedule).not.toHaveBeenCalled()
  })

  it('proves the exact canceled target phase when Stripe cleared both pointers', async () => {
    const f = scheduledFixture()
    f.canceled()
    const snapshot = BillingProviderSubscriptionSnapshotSchema.parse(
      await createStripeBillingProvider(f.sdk).retrieveSubscription(scheduledRequest.binding),
    )
    const verify = () => verifyInstalledStripeSchedule(f.sdk.retrieveSchedule, scheduledRequest.scheduled, snapshot)
    await expect(verify()).resolves.toBe(true)
    f.schedule.phases[0].items[0].price = 'price_other'
    await expect(verify()).resolves.toBe(false)
  })

  it('preserves the captured target after terminal cancellation without voiding it', async () => {
    const f = scheduledFixture()
    paid(f)
    f.canceled()
    f.subscription.cancel_at_period_end = true
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({
      kind: 'paid', invoiceId: request.invoiceId, providerStatus: 'canceled', cancelAtPeriodEnd: true,
    })
    await f.provider.voidInvoice(f.close)
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })

  it('honors a captured target payment observed before void and never sends a destructive write', async () => {
    const f = scheduledFixture()
    f.invoice.auto_advance = false
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({ kind: 'unpaid' })
    paid(f)
    await f.provider.voidInvoice(f.close)
    await f.provider.cancelSubscription(f.close)
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({
      kind: 'paid', invoiceId: request.invoiceId, periodStart: request.paidThrough, providerStatus: 'active',
    })
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
    expect(f.sdk.cancelSchedule).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('does not mutate an invoice with an in-flight scheduled target capture', async () => {
    const f = scheduledFixture()
    f.invoice.auto_advance = false
    f.intent.status = 'processing'
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({ kind: 'payment_pending' })
    await f.provider.voidInvoice(f.close)
    expect(f.beforeMutation).not.toHaveBeenCalled()
    expect(f.sdk.invoices.voidInvoice).not.toHaveBeenCalled()
  })

  it('uses the saved schedule cancel POST with both no-charge settings after exact void and the database fence', async () => {
    const f = scheduledFixture()
    await f.provider.cancelSubscription(f.close)
    expect(f.sdk.cancelSchedule).not.toHaveBeenCalled()
    voided(f)
    f.beforeMutation.mockResolvedValueOnce(false)
    await f.provider.cancelSubscription(f.close)
    expect(f.sdk.cancelSchedule).not.toHaveBeenCalled()
    await f.provider.cancelSubscription({ ...f.close, idempotencyKey: undefined })
    expect(f.sdk.cancelSchedule).not.toHaveBeenCalled()
    await f.provider.cancelSubscription(f.close)
    expect(f.sdk.cancelSchedule).toHaveBeenCalledExactlyOnceWith(scheduledRequest.scheduled.provider_schedule_id,
      { invoice_now: false, prorate: false }, { idempotencyKey: f.close.idempotencyKey })
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('reconciles a lost schedule cancel response when both attachment pointers are cleared', async () => {
    const f = scheduledFixture()
    voided(f)
    f.sdk.cancelSchedule.mockImplementation(async () => { f.canceled(); throw new Error('lost response') })
    await expect(f.provider.cancelSubscription(f.close)).rejects.toThrow('lost response')
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toEqual({
      kind: 'invoice_voided', invoiceId: request.invoiceId, subscriptionCanceled: true, obligationsCleared: true,
    })
    await f.provider.cancelSubscription(f.close)
    expect(f.sdk.cancelSchedule).toHaveBeenCalledTimes(1)
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('accepts the original amount remaining on an exact voided invoice with no collectible payment', async () => {
    const f = scheduledFixture()
    voided(f)
    f.invoice.amount_remaining = f.invoice.amount_due
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({ kind: 'invoice_voided' })
    f.invoice.amount_remaining -= 1
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toEqual({ kind: 'attention', reason: 'unexpected_money' })
  })

  it('does not claim closure when a terminal subscription still has other invoice obligations', async () => {
    const f = scheduledFixture()
    voided(f)
    f.canceled()
    f.sdk.invoices.list.mockResolvedValue({ object: 'list', has_more: true, data: [] })
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({ kind: 'attention' })
    await f.provider.cancelSubscription(f.close)
    expect(f.sdk.cancelSchedule).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('treats cancellation markers as historical after independently verifying terminal status', async () => {
    const f = scheduledFixture()
    f.subscription.cancel_at = 1793491200
    f.subscription.cancel_at_period_end = true
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({ kind: 'attention' })
    f.canceled()
    f.invoice.auto_advance = false
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({ kind: 'unpaid', collectionPaused: true })
    await f.provider.voidInvoice(f.close)
    expect(f.sdk.invoices.voidInvoice).toHaveBeenCalledExactlyOnceWith(request.invoiceId, {}, { idempotencyKey: f.close.idempotencyKey })
    voided(f)
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toEqual({
      kind: 'invoice_voided', invoiceId: request.invoiceId, subscriptionCanceled: true, obligationsCleared: true,
    })
    await f.provider.cancelSubscription(f.close)
    expect(f.sdk.cancelSchedule).not.toHaveBeenCalled()
  })

  it('rejects a scheduled target for a different account before provider reads', async () => {
    const f = scheduledFixture()
    const scheduled = { ...scheduledRequest.scheduled, target_binding: { ...binding, stripe_account: 'acct_other' } }
    await expect(f.provider.readCloseoutEvidence({ ...scheduledRequest, scheduled })).resolves.toEqual({
      kind: 'attention', reason: 'identity_mismatch',
    })
    expect(f.sdk.accounts.retrieve).not.toHaveBeenCalled()
  })

  it.each([
    ['detached active subscription', (f: ReturnType<typeof scheduledFixture>) => { f.subscription.schedule = null }],
    ['foreign subscription schedule pointer', (f: ReturnType<typeof scheduledFixture>) => { f.subscription.schedule = 'sub_sched_Other' }],
    ['foreign schedule returned', (f: ReturnType<typeof scheduledFixture>) => { f.schedule.id = 'sub_sched_Other' }],
    ['foreign schedule customer', (f: ReturnType<typeof scheduledFixture>) => { f.schedule.customer = 'cus_other' }],
    ['other schedule operation', (f: ReturnType<typeof scheduledFixture>) => {
      f.schedule.metadata.pika_plan_change_operation = '77777777-7777-4777-8777-777777777777'
    }],
    ['released schedule', (f: ReturnType<typeof scheduledFixture>) => { f.canceled(); f.schedule.status = 'released' }],
    ['null pointer without matching terminal schedule', (f: ReturnType<typeof scheduledFixture>) => {
      f.subscription.status = 'canceled'; f.subscription.schedule = null
    }],
    ['foreign detached schedule link', (f: ReturnType<typeof scheduledFixture>) => { f.canceled(); f.schedule.subscription = 'sub_other' }],
    ['wrong target price', (f: ReturnType<typeof scheduledFixture>) => { f.invoice.lines.data[0].pricing.price_details.price = 'price_Max' }],
    ['wrong schedule phase price', (f: ReturnType<typeof scheduledFixture>) => { f.schedule.phases[0].items[0].price = 'price_Max' }],
    ['prorated schedule phase', (f: ReturnType<typeof scheduledFixture>) => { f.schedule.phases[0].proration_behavior = 'create_prorations' }],
    ['prorated target invoice', (f: ReturnType<typeof scheduledFixture>) => { f.invoice.lines.data[0].parent.subscription_item_details.proration = true }],
    ['shortened target term', (f: ReturnType<typeof scheduledFixture>) => {
      f.invoice.lines.data[0].period.end--; f.subscription.items.data[0].current_period_end--
    }],
  ] as const)('rejects %s evidence without writing', async (_, mutate) => {
    const f = scheduledFixture()
    voided(f)
    mutate(f)
    await expect(f.provider.readCloseoutEvidence(scheduledRequest)).resolves.toMatchObject({ kind: 'attention' })
    await f.provider.cancelSubscription(f.close)
    expect(f.beforeMutation).not.toHaveBeenCalled()
    expect(f.sdk.cancelSchedule).not.toHaveBeenCalled()
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })

  it('does not fall back to subscription DELETE when schedule cancellation is unavailable', async () => {
    const f = scheduledFixture()
    voided(f)
    const provider = createStripeCloseoutProvider({ ...f.sdk, cancelSchedule: undefined })
    await provider.cancelSubscription(f.close)
    expect(f.sdk.subscriptions.cancel).not.toHaveBeenCalled()
  })
})
