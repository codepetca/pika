import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { createStripeCheckoutPort, createStripeCheckoutProvider, type StripeCheckoutPort } from '@/lib/server/billing/stripe-checkout-provider'
import { CheckoutAttemptSchema, type CheckoutAttempt } from '@/lib/server/billing/checkout-contracts'

const attempt: CheckoutAttempt = {
  attempt_id: 'b2100000-0000-4000-8000-000000000001', subject_user_id: 'b2100000-0000-4000-8000-000000000002',
  offering: { offering_version_id: 'b2100000-0000-4000-8000-000000000003', plan_key: 'plus', stripe_account: 'acct_test',
    stripe_product_id: 'prod_test', stripe_price_id: 'price_test', currency: 'usd', interval: 'month', unit_amount: 1900,
    classroom_limit: 5, catalog_key: 'pika:launch-2026-09-26:pro:usd:month' },
  lookup_key: 'pika:launch-2026-09-26:pro:usd:month', status: 'open', customer_id: 'cus_test', session_id: 'cs_test_abc',
  checkout_url: 'https://checkout.stripe.com/c/pay/abc', success_url: 'http://localhost:3000/billing?result=success',
  cancel_url: 'http://localhost:3000/billing?result=cancel', created_at: '2026-09-26T12:00:00Z',
  write_deadline: '2026-09-27T11:00:00Z', access_confirmed: false,
}
function response() {
  return { id: 'cs_test_abc', livemode: false, mode: 'subscription', ui_mode: 'hosted_page', customer: 'cus_test', subscription: null,
    status: 'open', payment_status: 'unpaid', url: attempt.checkout_url, currency: 'usd',
    amount_subtotal: 1900, amount_total: 1900, payment_method_types: ['card'], automatic_tax: { enabled: false },
    allow_promotion_codes: false, total_details: { amount_discount: 0, amount_tax: 0, amount_shipping: 0 },
    success_url: attempt.success_url, cancel_url: attempt.cancel_url,
    line_items: { has_more: false, data: [{ quantity: 1, amount_subtotal: 1900, amount_total: 1900,
      amount_discount: 0, amount_tax: 0, currency: 'usd', price: { id: 'price_test', product: 'prod_test',
        livemode: false, currency: 'usd', unit_amount: 1900, recurring: { interval: 'month', interval_count: 1 } } }] },
  }
}
function fixture(raw: unknown = response()) {
  const port: StripeCheckoutPort = {
    retrieveAccount: vi.fn(async () => ({ id: 'acct_test' })),
    createCustomer: vi.fn(async () => ({ id: 'cus_test', livemode: false })),
    retrieveCustomer: vi.fn(async () => ({ id: 'cus_test', livemode: false })),
    retrievePrice: vi.fn(),
    createSession: vi.fn(async () => raw), retrieveSession: vi.fn(async () => raw),
  }
  return { port, provider: createStripeCheckoutProvider(port) }
}
describe('Stripe hosted checkout boundary', () => {
  it('validates the complete selected terms and retrieves only the persisted session', async () => {
    const f = fixture()
    await f.provider.assertAccount('acct_test')
    expect(await f.provider.retrieveSession(attempt)).toEqual({ id: 'cs_test_abc', customerId: 'cus_test',
      subscriptionId: null, status: 'open', paymentStatus: 'unpaid', url: attempt.checkout_url })
    expect(f.port.retrieveSession).toHaveBeenCalledWith('cs_test_abc')
  })
  it.each([
    ['live environment', (r: ReturnType<typeof response>) => { r.livemode = true }],
    ['embedded checkout', r => { r.ui_mode = 'embedded_page' }],
    ['foreign customer', r => { r.customer = 'cus_foreign' }],
    ['foreign session', r => { r.id = 'cs_test_foreign' }],
    ['wrong price', r => { r.line_items.data[0].price.id = 'price_other' }],
    ['wrong product', r => { r.line_items.data[0].price.product = 'prod_other' }],
    ['wrong currency', r => { r.currency = 'cad' }],
    ['wrong interval', r => { r.line_items.data[0].price.recurring.interval = 'year' }],
    ['wrong amount', r => { r.amount_total = 100 }],
    ['extra item', r => { r.line_items.data.push(r.line_items.data[0]) }],
    ['non-card method', r => { r.payment_method_types = ['link'] }],
    ['tax', r => { r.total_details.amount_tax = 100 }],
    ['discount', r => { r.total_details.amount_discount = 100 }],
    ['untrusted URL', r => { r.url = 'https://checkout.stripe.com.evil.example/pay' }],
    ['URL credentials', r => { r.url = 'https://user@checkout.stripe.com/pay' }],
    ['return destination', r => { r.success_url = 'https://evil.example' }],
    ['unexpanded items', r => { r.line_items.has_more = true }],
  ] as const)('rejects %s without binding', async (_label, mutate) => {
    const raw = response(); mutate(raw)
    await expect(fixture(raw).provider.retrieveSession(attempt)).rejects.toThrow('contract is invalid')
  })
  it('does not treat a completed but unpaid session as a paid purchase', async () => {
    const raw = { ...response(), status: 'complete', subscription: 'sub_test', url: null }
    expect((await fixture(raw).provider.retrieveSession(attempt)).paymentStatus).toBe('unpaid')
  })
  it('rejects another merchant and live customer objects', async () => {
    const f = fixture()
    await expect(f.provider.assertAccount('acct_foreign')).rejects.toThrow('contract is invalid')
    vi.mocked(f.port.createCustomer).mockResolvedValue({ id: 'cus_test', livemode: true })
    await expect(f.provider.createCustomer('stable-key')).rejects.toThrow('contract is invalid')
  })
  it('pins the SDK creation options, return URLs and idempotency keys', async () => {
    const create = vi.fn(async () => response())
    const retrieve = vi.fn(async () => response())
    const customer = vi.fn(async () => ({ id: 'cus_test', livemode: false }))
    const retrieveCustomer = vi.fn(); const retrievePrice = vi.fn()
    const sdk = { accounts: { retrieve: vi.fn() }, customers: { create: customer, retrieve: retrieveCustomer }, prices: { retrieve: retrievePrice }, checkout: { sessions: { create, retrieve } } }
    const port = createStripeCheckoutPort(sdk as unknown as Stripe)
    await port.createSession(attempt, 'cus_test', 'session-key')
    await port.createCustomer('customer-key')
    await port.retrieveSession('cs_test_abc')
    await port.retrieveCustomer('cus_test')
    await port.retrievePrice('price_test')
    expect(create).toHaveBeenCalledWith({ mode: 'subscription', ui_mode: 'hosted_page', customer: 'cus_test',
      line_items: [{ price: 'price_test', quantity: 1 }], payment_method_types: ['card'], allow_promotion_codes: false,
      automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false }, success_url: attempt.success_url,
      cancel_url: attempt.cancel_url, expand: ['line_items.data.price'] }, { idempotencyKey: 'session-key' })
    expect(customer).toHaveBeenCalledWith({}, { idempotencyKey: 'customer-key' })
    expect(retrieve).toHaveBeenCalledWith('cs_test_abc', { expand: ['line_items.data.price'] })
    expect(retrieveCustomer).toHaveBeenCalledWith('cus_test')
    expect(retrievePrice).toHaveBeenCalledWith('price_test', { expand: ['product'] })
  })
})

const liveAttempt: CheckoutAttempt = { ...attempt, offering: { ...attempt.offering, provider_mode: 'live', stripe_account: 'acct_live' },
  session_id: 'cs_live_abc', customer_id: 'cus_live' }
function liveSession() {
  const raw = response()
  return { ...raw, id: 'cs_live_abc', livemode: true, customer: 'cus_live',
    line_items: { ...raw.line_items, data: [{ ...raw.line_items.data[0], price: { ...raw.line_items.data[0].price, livemode: true, billing_scheme: 'per_unit', tax_behavior: 'unspecified', transform_quantity: null, unit_amount_decimal: '1900', recurring: { ...raw.line_items.data[0].price.recurring, usage_type: 'licensed', trial_period_days: null } } }] } }
}
function livePrice() {
  return { id: 'price_test', livemode: true, active: true, type: 'recurring', billing_scheme: 'per_unit', currency: 'usd', unit_amount: 1900, unit_amount_decimal: '1900',
    tax_behavior: 'unspecified', transform_quantity: null, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed', trial_period_days: null },
    product: { id: 'prod_test', livemode: true, active: true } }
}
function liveFixture() {
  const port: StripeCheckoutPort = { retrieveAccount: vi.fn(async () => ({ id: 'acct_live' })),
    createCustomer: vi.fn(async () => ({ id: 'cus_live', livemode: true })),
    retrieveCustomer: vi.fn(async () => ({ id: 'cus_live', livemode: true })),
    retrievePrice: vi.fn(async () => livePrice()), createSession: vi.fn(async () => liveSession()),
    retrieveSession: vi.fn(async () => liveSession()) }
  return { port, provider: createStripeCheckoutProvider(port, { providerMode: 'live', stripeAccount: 'acct_live' }) }
}
describe('explicit live checkout boundary', () => {
  const assertCanWrite = () => {}
  it('attests account, customer, and active expanded terms before creation and verifies live session', async () => {
    const { port, provider } = liveFixture()
    expect(await provider.createCustomer('customer-key', assertCanWrite)).toBe('cus_live')
    expect(await provider.createSession(liveAttempt, 'cus_live', 'session-key', assertCanWrite)).toMatchObject({ id: 'cs_live_abc' })
    expect(port.retrievePrice).toHaveBeenCalledWith('price_test')
    expect(vi.mocked(port.retrievePrice).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(port.createSession).mock.invocationCallOrder[0])
    expect(port.retrieveAccount).toHaveBeenCalledTimes(2)
    expect(port.retrieveCustomer).toHaveBeenCalledWith('cus_live')
  })
  it('checks the write deadline after provider reads and before creating payable objects', async () => {
    const { port, provider } = liveFixture()
    const expired = vi.fn(() => { throw new Error('expired checkout fence') })
    await expect(provider.createCustomer('customer-key', expired)).rejects.toThrow('expired checkout fence')
    expect(port.createCustomer).not.toHaveBeenCalled()
    await expect(provider.createSession(liveAttempt, 'cus_live', 'session-key', expired)).rejects.toThrow('expired checkout fence')
    expect(port.retrievePrice).toHaveBeenCalledOnce()
    expect(port.createSession).not.toHaveBeenCalled()
  })
  it('recovers only the pinned session without checking whether its price remains active', async () => {
    const { port, provider } = liveFixture()
    expect((await provider.retrieveSession(liveAttempt)).id).toBe('cs_live_abc')
    expect(port.retrievePrice).not.toHaveBeenCalled()
    expect(port.retrieveAccount).toHaveBeenCalledOnce()
    expect(port.retrieveCustomer).toHaveBeenCalledWith('cus_live')
  })
  it.each([
    ['missing mode', { ...liveAttempt, offering: { ...liveAttempt.offering, provider_mode: undefined } }],
    ['test mode', { ...liveAttempt, offering: { ...liveAttempt.offering, provider_mode: 'test' } }],
    ['foreign offering account', { ...liveAttempt, offering: { ...liveAttempt.offering, stripe_account: 'acct_foreign' } }],
    ['test session id', { ...liveAttempt, session_id: 'cs_test_abc' }],
    ['foreign customer', { ...liveAttempt, customer_id: 'cus_other' }],
  ])('rejects %s before price or session writes', async (_label, candidate) => {
    const { port, provider } = liveFixture()
    await expect(provider.createSession(candidate as CheckoutAttempt, 'cus_live', 'key', assertCanWrite)).rejects.toThrow('contract is invalid')
    expect(port.createSession).not.toHaveBeenCalled()
    expect(port.retrievePrice).not.toHaveBeenCalled()
  })
  it.each([
    ['inactive price', (p: ReturnType<typeof livePrice>) => { p.active = false }],
    ['test price', p => { p.livemode = false }],
    ['wrong price', p => { p.id = 'price_other' }],
    ['inactive product', p => { p.product.active = false }],
    ['test product', p => { p.product.livemode = false }],
    ['wrong product', p => { p.product.id = 'prod_other' }],
    ['currency', p => { p.currency = 'cad' }],
    ['amount', p => { p.unit_amount = 1800 }],
    ['interval', p => { p.recurring.interval = 'year' }],
    ['fractional amount', p => { p.unit_amount_decimal = '1900.5' }],
    ['interval count', p => { p.recurring.interval_count = 2 }],
    ['metered', p => { p.recurring.usage_type = 'metered' }],
    ['inclusive tax', p => { p.tax_behavior = 'inclusive' }],
    ['embedded trial', p => { (p.recurring.trial_period_days as number | null) = 7 }],
    ['unexpanded product', p => { (p.product as unknown) = 'prod_test' }],
  ] as const)('rejects %s before creating a payable session', async (_label, mutate) => {
    const { port, provider } = liveFixture(); const price = livePrice(); mutate(price)
    vi.mocked(port.retrievePrice).mockResolvedValue(price)
    await expect(provider.createSession(liveAttempt, 'cus_live', 'key', assertCanWrite)).rejects.toThrow('contract is invalid')
    expect(port.retrievePrice).toHaveBeenCalledOnce()
    expect(port.createSession).not.toHaveBeenCalled()
  })
  it('fails closed on wrong merchant or customer evidence before creation', async () => {
    const { port, provider } = liveFixture()
    vi.mocked(port.retrieveAccount).mockResolvedValueOnce({ id: 'acct_other' })
    await expect(provider.createSession(liveAttempt, 'cus_live', 'key', assertCanWrite)).rejects.toThrow('contract is invalid')
    expect(port.retrieveCustomer).not.toHaveBeenCalled()
    vi.mocked(port.retrieveCustomer).mockResolvedValueOnce({ id: 'cus_live', livemode: false })
    await expect(provider.createSession(liveAttempt, 'cus_live', 'key', assertCanWrite)).rejects.toThrow('contract is invalid')
    expect(port.retrievePrice).not.toHaveBeenCalled()
    expect(port.createSession).not.toHaveBeenCalled()
  })
  it.each(['session mode', 'price mode', 'session id', 'customer', 'discount', 'tax'])('rejects mismatched live %s during recovery', async kind => {
    const { port, provider } = liveFixture(); const raw = liveSession()
    if (kind === 'session mode') raw.livemode = false
    if (kind === 'price mode') raw.line_items.data[0].price.livemode = false
    if (kind === 'session id') raw.id = 'cs_test_abc'
    if (kind === 'customer') raw.customer = 'cus_other'
    if (kind === 'discount') raw.total_details.amount_discount = 100
    if (kind === 'tax') raw.total_details.amount_tax = 100
    vi.mocked(port.retrieveSession).mockResolvedValue(raw)
    await expect(provider.retrieveSession(liveAttempt)).rejects.toThrow('contract is invalid')
  })
  it('rejects nonempty discount and tax structures even when totals claim zero', async () => {
    const { port, provider } = liveFixture()
    for (const extra of [{ discounts: [{ coupon: 'coupon' }] }, { total_details: { ...liveSession().total_details, breakdown: { discounts: [], taxes: [{ amount: 0 }] } } }]) {
      vi.mocked(port.retrieveSession).mockResolvedValueOnce({ ...liveSession(), ...extra })
      await expect(provider.retrieveSession(liveAttempt)).rejects.toThrow('contract is invalid')
    }
  })
  it('decodes only session IDs matching the explicit offering mode', () => {
    expect(CheckoutAttemptSchema.safeParse(attempt).success).toBe(true)
    expect(CheckoutAttemptSchema.safeParse(liveAttempt).success).toBe(true)
    expect(CheckoutAttemptSchema.safeParse({ ...liveAttempt, session_id: 'cs_test_abc' }).success).toBe(false)
    expect(CheckoutAttemptSchema.safeParse({ ...attempt, session_id: 'cs_live_abc' }).success).toBe(false)
    expect(CheckoutAttemptSchema.safeParse({ ...attempt, offering: { ...attempt.offering, provider_mode: 'unknown' } }).success).toBe(false)
  })
  it('does not let the default sandbox provider consume a live attempt', async () => {
    const { port, provider } = fixture()
    await expect(provider.retrieveSession(liveAttempt)).rejects.toThrow('contract is invalid')
    expect(port.retrieveSession).not.toHaveBeenCalled()
  })
})

describe('exclusive Stripe Tax checkout', () => {
  const taxedAttempt: CheckoutAttempt = { ...liveAttempt, offering: { ...liveAttempt.offering, tax_mode: 'stripe_exclusive' } }
  function taxedSession(status: 'open' | 'complete' | 'expired' = 'open') {
    const raw = liveSession()
    return { ...raw, status, subscription: status === 'complete' ? 'sub_live' : null,
      billing_address_collection: 'required', shipping_cost: null, shipping_options: [], shipping_address_collection: null,
      automatic_tax: { enabled: true, liability: { type: 'self' }, status: status === 'complete' ? 'complete' : null },
      amount_total: 2147, total_details: { ...raw.total_details, amount_tax: 247 },
      line_items: { ...raw.line_items, data: [{ ...raw.line_items.data[0], amount_total: 2147, amount_tax: 247,
        price: { ...raw.line_items.data[0].price, tax_behavior: 'exclusive' } }] } }
  }
  it.each(['open', 'expired', 'complete'] as const)('recovers exact base plus tax for %s', async status => {
    const { port, provider } = liveFixture()
    vi.mocked(port.retrieveSession).mockResolvedValue(taxedSession(status))
    expect((await provider.retrieveSession(taxedAttempt)).status).toBe(status)
  })
  it('rejects unfinished tax, inconsistent totals and merchant liability', async () => {
    const { port, provider } = liveFixture()
    const base = taxedSession('complete')
    for (const changed of [
      { automatic_tax: { ...base.automatic_tax, status: 'failed' } },
      { automatic_tax: { ...base.automatic_tax, liability: { type: 'account' } } },
      { amount_total: 1900 }, { shipping_options: [{}] }, { billing_address_collection: 'auto' },
    ]) {
      vi.mocked(port.retrieveSession).mockResolvedValueOnce({ ...base, ...changed })
      await expect(provider.retrieveSession(taxedAttempt)).rejects.toThrow('contract is invalid')
    }
  })
  it('requires the exclusive price before session creation', async () => {
    const { port, provider } = liveFixture()
    await expect(provider.createSession(taxedAttempt, 'cus_live', 'key', () => {})).rejects.toThrow('contract is invalid')
    expect(port.createSession).not.toHaveBeenCalled()
    vi.mocked(port.retrievePrice).mockResolvedValue({ ...livePrice(), tax_behavior: 'exclusive' })
    vi.mocked(port.createSession).mockResolvedValue(taxedSession())
    await expect(provider.createSession(taxedAttempt, 'cus_live', 'key', () => {})).resolves.toMatchObject({ id: 'cs_live_abc' })
  })
  it('pins tax and address parameters to the persisted offering', async () => {
    const create = vi.fn()
    const port = createStripeCheckoutPort({ checkout: { sessions: { create } } } as unknown as Stripe)
    await port.createSession(taxedAttempt, 'cus_live', 'key')
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ automatic_tax: { enabled: true, liability: { type: 'self' } },
      billing_address_collection: 'required', customer_update: { address: 'auto' }, allow_promotion_codes: false }), { idempotencyKey: 'key' })
  })
})
