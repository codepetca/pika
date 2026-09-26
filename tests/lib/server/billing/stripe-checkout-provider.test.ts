import { describe, expect, it, vi } from 'vitest'
import type Stripe from 'stripe'
import { createStripeCheckoutPort, createStripeCheckoutProvider, type StripeCheckoutPort } from '@/lib/server/billing/stripe-checkout-provider'
import type { CheckoutAttempt } from '@/lib/server/billing/checkout-contracts'

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
    const sdk = { accounts: { retrieve: vi.fn() }, customers: { create: customer }, checkout: { sessions: { create, retrieve } } }
    const port = createStripeCheckoutPort(sdk as unknown as Stripe)
    await port.createSession(attempt, 'cus_test', 'session-key')
    await port.createCustomer('customer-key')
    await port.retrieveSession('cs_test_abc')
    expect(create).toHaveBeenCalledWith({ mode: 'subscription', ui_mode: 'hosted_page', customer: 'cus_test',
      line_items: [{ price: 'price_test', quantity: 1 }], payment_method_types: ['card'], allow_promotion_codes: false,
      automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false }, success_url: attempt.success_url,
      cancel_url: attempt.cancel_url, expand: ['line_items.data.price'] }, { idempotencyKey: 'session-key' })
    expect(customer).toHaveBeenCalledWith({}, { idempotencyKey: 'customer-key' })
    expect(retrieve).toHaveBeenCalledWith('cs_test_abc', { expand: ['line_items.data.price'] })
  })
})
