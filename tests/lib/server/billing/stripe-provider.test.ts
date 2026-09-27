import { describe, expect, it, vi } from 'vitest'
import { createStripeBillingProvider } from '@/lib/server/billing/stripe-provider'
import { verifyPaidSubscriptionSnapshot } from '@/lib/server/billing/synchronize'

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

function fixture() {
  const subscription = {
    id: 'sub_fixture', livemode: false, customer: 'cus_fixture', status: 'active',
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
    id: 'in_fixture', livemode: false, status: 'paid', customer: 'cus_fixture',
    currency: 'usd', amount_due: 2000, amount_paid: 2000, amount_remaining: 0,
    billing_reason: 'subscription_create', subtotal: 2000, total: 2000,
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
      status: 'paid', amount_paid: 2000,
      payment: { type: 'payment_intent', payment_intent: 'pi_fixture' },
    }] },
  }
  const intent = { id: 'pi_fixture', livemode: false, customer: 'cus_fixture',
    currency: 'usd', status: 'succeeded', amount_received: 2000, latest_charge: 'ch_fixture' }
  const charge = { id: 'ch_fixture', livemode: false, customer: 'cus_fixture',
    currency: 'usd', payment_intent: 'pi_fixture', captured: true, paid: true,
    refunded: false, amount_refunded: 0, disputed: false, status: 'succeeded' }
  Object.assign(charge, { payment_method_details: { type: 'card' } })
  const sdk = {
    accounts: { retrieve: vi.fn().mockResolvedValue({ id: 'acct_fixture' }) },
    subscriptions: { retrieve: vi.fn().mockResolvedValue(subscription) },
    invoices: {
      retrieve: vi.fn().mockResolvedValue(invoice),
      list: vi.fn().mockResolvedValue({ object: 'list', has_more: false, data: [] }),
    },
    paymentIntents: { retrieve: vi.fn().mockResolvedValue(intent) },
    charges: { retrieve: vi.fn().mockResolvedValue(charge) },
  }
  return { sdk, subscription, invoice, intent, charge }
}

function makeUnpaidInvoice(
  fixture: ReturnType<typeof fixture>,
  status: 'draft' | 'open' | 'uncollectible' | 'void' = 'open',
) {
  fixture.invoice.status = status
  fixture.invoice.amount_paid = 0
  fixture.invoice.amount_remaining = status === 'void' ? 0 : fixture.invoice.amount_due
  fixture.invoice.payments.data = []
}

function unpaidPayment(status: 'open' | 'canceled' = 'open', amountPaid: number | null = null) {
  return {
    id: 'inpay_unpaid', object: 'invoice_payment', amount_paid: amountPaid, amount_requested: 2000,
    created: 1790812800, currency: 'usd', invoice: 'in_fixture', is_default: true, livemode: false,
    payment: { type: 'payment_intent', payment_intent: 'pi_unpaid' }, status,
    status_transitions: { canceled_at: status === 'canceled' ? 1790812801 : null, paid_at: null },
  }
}

describe('Stripe current-state adapter', () => {
  it('fetches the bound objects and proves an actual Stripe payment before assignment', async () => {
    const { sdk } = fixture()
    const snapshot = await createStripeBillingProvider(sdk).retrieveSubscription(binding)
    expect(verifyPaidSubscriptionSnapshot(binding, snapshot)).toMatchObject({ invoiceId: 'in_fixture' })
    expect(sdk.subscriptions.retrieve).toHaveBeenCalledWith('sub_fixture')
    expect(sdk.paymentIntents.retrieve).toHaveBeenCalledWith('pi_fixture')
  })
  it('accepts a full expanded paid InvoicePayment while projecting only verified evidence', async () => {
    const f = fixture()
    Object.assign(f.invoice.payments.data[0], {
      id: 'inpay_paid', object: 'invoice_payment', amount_requested: 2000, created: 1790812800,
      currency: 'usd', is_default: true, status_transitions: { canceled_at: null, paid_at: 1790812801 },
    })

    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

    expect(verifyPaidSubscriptionSnapshot(binding, snapshot)).toMatchObject({ invoiceId: 'in_fixture' })
  })
  it.each(['partial_refund', 'wrong_account', 'truncated_lines', 'unpaid_intent', 'live_invoice'])('rejects %s', async kind => {
    const f = fixture()
    if (kind === 'partial_refund') f.charge.amount_refunded = 1
    if (kind === 'wrong_account') f.sdk.accounts.retrieve.mockResolvedValue({ id: 'acct_other' })
    if (kind === 'truncated_lines') f.invoice.lines.has_more = true
    if (kind === 'unpaid_intent') f.intent.status = 'processing'
    if (kind === 'live_invoice') f.invoice.livemode = true
    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)
    expect(typeof verifyPaidSubscriptionSnapshot(binding, snapshot)).toBe('string')
  })
  it('propagates transport failures so synchronization can schedule recovery', async () => {
    const { sdk } = fixture()
    sdk.subscriptions.retrieve.mockRejectedValue(new Error('transport failure'))
    await expect(createStripeBillingProvider(sdk).retrieveSubscription(binding)).rejects.toThrow()
  })
  it('proves a canceled subscription has no draft, open, or uncollectible obligations', async () => {
    const f = fixture()
    f.subscription.status = 'canceled'

    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

    expect(snapshot).toMatchObject({ status: 'canceled', terminalObligationsCleared: true })
    expect(f.sdk.invoices.list).toHaveBeenNthCalledWith(1, {
      subscription: binding.stripe_subscription_id, status: 'draft', limit: 1,
    })
    expect(f.sdk.invoices.list).toHaveBeenNthCalledWith(2, {
      subscription: binding.stripe_subscription_id, status: 'open', limit: 1,
    })
    expect(f.sdk.invoices.list).toHaveBeenNthCalledWith(3, {
      subscription: binding.stripe_subscription_id, status: 'uncollectible', limit: 1,
    })
  })
  it.each(['draft', 'open', 'uncollectible'] as const)(
    'does not clear a canceled subscription with an outstanding %s invoice',
    async status => {
      const f = fixture()
      f.subscription.status = 'canceled'
      f.sdk.invoices.list.mockImplementation(async request => ({
        object: 'list', has_more: false, data: request.status === status ? [{ id: 'in_outstanding' }] : [],
      }))

      const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

      expect(snapshot).toMatchObject({ terminalObligationsCleared: false })
      expect(f.sdk.invoices.list).toHaveBeenCalledTimes(3)
    },
  )
  it.each(['paid', 'void'] as const)(
    'does not shortcut canceled obligations from a latest %s invoice',
    async latestStatus => {
      const f = fixture()
      f.subscription.status = 'canceled'
      if (latestStatus === 'void') makeUnpaidInvoice(f, 'void')
      f.sdk.invoices.list.mockImplementation(async request => ({
        object: 'list', has_more: false, data: request.status === 'open' ? [{ id: 'in_outstanding' }] : [],
      }))

      const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

      expect(snapshot).toMatchObject({ terminalObligationsCleared: false })
      expect(f.sdk.invoices.list).toHaveBeenCalledTimes(3)
    },
  )
  it.each([
    ['paginated result', { object: 'list', has_more: true, data: [] }],
    ['malformed result', { object: 'invoice_list', has_more: false, data: [] }],
    ['missing data', { object: 'list', has_more: false }],
  ])('does not clear a canceled subscription from a %s', async (_label, result) => {
    const f = fixture()
    f.subscription.status = 'canceled'
    f.sdk.invoices.list.mockResolvedValue(result)

    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

    expect(snapshot).toMatchObject({ terminalObligationsCleared: false })
    expect(f.sdk.invoices.list).toHaveBeenCalledTimes(3)
  })
  it('does not clear a canceled subscription when a complete list contains a malformed row', async () => {
    const f = fixture()
    f.subscription.status = 'canceled'
    f.sdk.invoices.list.mockResolvedValue({ object: 'list', has_more: false, data: [{ unexpected: true }] })

    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

    expect(snapshot).toMatchObject({ terminalObligationsCleared: false })
    expect(f.sdk.invoices.list).toHaveBeenCalledTimes(3)
  })
  it('propagates canceled-obligation list outages for retry', async () => {
    const f = fixture()
    f.subscription.status = 'canceled'
    f.sdk.invoices.list.mockRejectedValue(new Error('provider outage'))

    await expect(createStripeBillingProvider(f.sdk).retrieveSubscription(binding)).rejects.toThrow('provider outage')
  })
  it('keeps terminal clearance false when the invoice-list port is unavailable', async () => {
    const f = fixture()
    f.subscription.status = 'canceled'
    const { list: _list, ...invoices } = f.sdk.invoices

    const snapshot = await createStripeBillingProvider({ ...f.sdk, invoices }).retrieveSubscription(binding)

    expect(snapshot).toMatchObject({ terminalObligationsCleared: false })
  })
  it('does not query terminal obligations for an active subscription or an unbound snapshot', async () => {
    const active = fixture()
    await createStripeBillingProvider(active.sdk).retrieveSubscription(binding)
    expect(active.sdk.invoices.list).not.toHaveBeenCalled()

    const unbound = fixture()
    unbound.subscription.customer = 'cus_other'
    await expect(createStripeBillingProvider(unbound.sdk).retrieveSubscription(binding)).resolves.toBeNull()
    expect(unbound.sdk.invoices.list).not.toHaveBeenCalled()
  })
  it('normalizes a complete failed renewal without treating it as paid evidence', async () => {
    const f = fixture()
    f.subscription.status = 'past_due'
    makeUnpaidInvoice(f)
    f.invoice.payments.data = [unpaidPayment()]

    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

    expect(snapshot).toMatchObject({
      status: 'past_due',
      latestInvoice: { status: 'open', amountPaid: 0, payments: [] },
    })
    expect(f.sdk.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(f.sdk.charges.retrieve).not.toHaveBeenCalled()
    expect(verifyPaidSubscriptionSnapshot(binding, snapshot)).toBe('subscription_not_active')
  })
  it('normalizes a canceled, zero-payment InvoicePayment without fetching its intent', async () => {
    const f = fixture()
    makeUnpaidInvoice(f)
    f.invoice.payments.data = [unpaidPayment('canceled', 0)]

    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

    expect(snapshot).toMatchObject({ latestInvoice: { status: 'open', payments: [] } })
    expect(f.sdk.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(f.sdk.charges.retrieve).not.toHaveBeenCalled()
  })
  it('keeps an incomplete first purchase ungranted when its invoice has no captured payment', async () => {
    const f = fixture()
    f.subscription.status = 'incomplete'
    makeUnpaidInvoice(f)

    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

    expect(snapshot).toMatchObject({ latestInvoice: { status: 'open', payments: [] } })
    expect(verifyPaidSubscriptionSnapshot(binding, snapshot)).toBe('subscription_not_active')
  })
  it.each(['draft', 'open', 'uncollectible', 'void'] as const)(
    'retains a complete no-payment %s invoice for lifecycle evaluation',
    async status => {
      const f = fixture()
      makeUnpaidInvoice(f, status)

      const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)

      expect(snapshot).toMatchObject({ latestInvoice: { status, amountPaid: 0, payments: [] } })
      expect(verifyPaidSubscriptionSnapshot(binding, snapshot)).toBe('invoice_not_paid')
      expect(f.sdk.paymentIntents.retrieve).not.toHaveBeenCalled()
    },
  )
  it.each([
    ['truncated payments', (f: ReturnType<typeof fixture>) => { makeUnpaidInvoice(f); f.invoice.payments.has_more = true }],
    ['live-mode invoice', (f: ReturnType<typeof fixture>) => { makeUnpaidInvoice(f); f.invoice.livemode = true }],
    ['mismatched invoice ID', (f: ReturnType<typeof fixture>) => { makeUnpaidInvoice(f); f.invoice.id = 'in_other' }],
    ['a mixed paid and unpaid entry', (f: ReturnType<typeof fixture>) => {
      const paid = structuredClone(f.invoice.payments.data[0])
      makeUnpaidInvoice(f)
      f.invoice.payments.data = [paid, unpaidPayment()]
    }],
    ['an unknown payment status', (f: ReturnType<typeof fixture>) => {
      makeUnpaidInvoice(f)
      f.invoice.payments.data = [{ invoice: 'in_fixture', livemode: false, status: 'unknown', amount_paid: 0,
        payment: { type: 'payment_intent', payment_intent: 'pi_unknown' } }]
    }],
    ['a non-payment-intent record', (f: ReturnType<typeof fixture>) => {
      makeUnpaidInvoice(f)
      f.invoice.payments.data = [{ ...unpaidPayment(), payment: { type: 'payment_record', payment_record: 'pr_unpaid' } }]
    }],
    ['positive payment evidence', (f: ReturnType<typeof fixture>) => {
      makeUnpaidInvoice(f)
      f.invoice.payments.data = [unpaidPayment('open', 1)]
    }],
    ['a foreign invoice payment', (f: ReturnType<typeof fixture>) => {
      makeUnpaidInvoice(f)
      f.invoice.payments.data = [{ ...unpaidPayment(), invoice: 'in_foreign' }]
    }],
    ['a live-mode invoice payment', (f: ReturnType<typeof fixture>) => {
      makeUnpaidInvoice(f)
      f.invoice.payments.data = [{ ...unpaidPayment(), livemode: true }]
    }],
    ['missing payment-intent metadata', (f: ReturnType<typeof fixture>) => {
      makeUnpaidInvoice(f)
      f.invoice.payments.data = [{ ...unpaidPayment(), payment: { type: 'payment_intent' } }]
    }],
  ] as const)('fails closed for %s on a non-paid invoice', async (_label, mutate) => {
    const f = fixture()
    mutate(f)

    await expect(createStripeBillingProvider(f.sdk).retrieveSubscription(binding)).resolves.toBeNull()
    expect(f.sdk.paymentIntents.retrieve).not.toHaveBeenCalled()
    expect(f.sdk.charges.retrieve).not.toHaveBeenCalled()
  })
  it.each(['discount', 'customer_credit', 'tax', 'credit_note', 'non_card', 'manual_invoice'])('preserves the commercial facts needed to reject %s', async kind => {
    const f = fixture()
    if (kind === 'discount' || kind === 'customer_credit') {
      f.invoice.amount_due = 100
      f.invoice.amount_paid = 100
      f.invoice.payments.data[0].amount_paid = 100
      f.intent.amount_received = 100
    }
    if (kind === 'discount') {
      f.invoice.total = 100
      f.invoice.discounts = ['di_fixture']
      f.invoice.total_discount_amounts = [{ amount: 1900 }]
    }
    if (kind === 'customer_credit') f.invoice.starting_balance = -1900
    if (kind === 'tax') f.invoice.total_taxes = [{ amount: 100 }]
    if (kind === 'credit_note') f.invoice.post_payment_credit_notes_amount = 500
    if (kind === 'non_card') Object.assign(f.charge, { payment_method_details: { type: 'us_bank_account' } })
    if (kind === 'manual_invoice') f.invoice.billing_reason = 'manual'
    const snapshot = await createStripeBillingProvider(f.sdk).retrieveSubscription(binding)
    expect(snapshot).not.toBeNull()
    expect(verifyPaidSubscriptionSnapshot(binding, snapshot)).toBe('financial_terms_unapproved')
  })
})
