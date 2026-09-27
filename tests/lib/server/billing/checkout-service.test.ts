import { describe, expect, it, vi } from 'vitest'
import { createCheckoutService } from '@/lib/server/billing/checkout-service'
import { CheckoutProviderContractError, type CheckoutAttempt, type CheckoutProvider, type CheckoutStore } from '@/lib/server/billing/checkout-contracts'

const user = 'a2100000-0000-4000-8000-000000000001'
const id = 'a2100000-0000-4000-8000-000000000002'
const version = 'a2100000-0000-4000-8000-000000000003'
const lease = 'a2100000-0000-4000-8000-000000000004'
const at = Date.parse('2026-09-26T12:00:00Z')
const offering = { offering_version_id: version, plan_key: 'plus' as const, stripe_account: 'acct_test',
  stripe_product_id: 'prod_test', stripe_price_id: 'price_test', currency: 'usd' as const, interval: 'month' as const,
  unit_amount: 1900, classroom_limit: 5, catalog_key: 'pika:launch-2026-09-26:pro:usd:month' }
function fixture() {
  let row: CheckoutAttempt | null = null
  const sequence: string[] = []
  const store: CheckoutStore = {
    getCheckoutOffering: vi.fn(async () => offering),
    getCheckout: vi.fn(async ({ subject_user_id }) => row?.subject_user_id === subject_user_id ? structuredClone(row) : null),
    reserveCheckout: vi.fn(async request => {
      sequence.push('reserve')
      row = { ...request, offering: structuredClone(request.offering), status: 'reserved', customer_id: null,
        session_id: null, checkout_url: null, created_at: new Date(at).toISOString(),
        write_deadline: new Date(at + 23 * 3600_000).toISOString(), access_confirmed: false }
      return structuredClone(row)
    }),
    claimCheckout: vi.fn(async () => ({ status: 'claimed', attempt: structuredClone(row),
      lease_token: lease, fencing_token: 1, lease_expires_at: new Date(at + 120_000).toISOString() })),
    saveCheckoutProgress: vi.fn(async request => {
      if (request.customer_id) row!.customer_id = request.customer_id
      if (request.session_id) { row!.session_id = request.session_id; row!.checkout_url = request.checkout_url ?? null; row!.status = 'open' }
      return { status: 'saved' }
    }),
    finishCheckout: vi.fn(async request => {
      row!.status = request.outcome === 'pending' ? request.payment_pending ? 'payment_pending' : 'open'
        : request.outcome === 'retry' ? row!.status : request.outcome
      return { status: 'finished' }
    }),
    listCheckoutWork: vi.fn(async () => ({ attempt_ids: [id] })),
  }
  const open = { id: 'cs_test_abc', customerId: 'cus_test', subscriptionId: null,
    status: 'open' as const, paymentStatus: 'unpaid' as const, url: 'https://checkout.stripe.com/c/pay/abc' }
  const provider: CheckoutProvider = {
    assertAccount: vi.fn(async () => { sequence.push('account') }),
    createCustomer: vi.fn(async () => { sequence.push('customer'); return 'cus_test' }),
    createSession: vi.fn(async () => { sequence.push('session'); return open }),
    retrieveSession: vi.fn(async () => open),
  }
  const service = createCheckoutService({ store, provider, stripeAccount: 'acct_test', returnOrigin: 'http://localhost:3000',
    validateOffering: candidate => candidate.catalog_key === offering.catalog_key ? { lookupKey: offering.catalog_key } : null,
    now: () => at })
  const start = () => service.startCheckout({ subjectUserId: user, offeringVersionId: version, operationId: id })
  return { store, provider, service, start, sequence, row: () => row!, open }
}

describe('durable hosted checkout orchestration', () => {
  it('reserves before provider writes, verifies merchant, reuses fixed keys and redacts identity', async () => {
    const f = fixture()
    expect(await f.start()).toEqual({ attemptId: id, status: 'checkout_open', checkoutUrl: f.open.url })
    expect(f.sequence).toEqual(['reserve','account','customer','session'])
    expect(f.provider.createCustomer).toHaveBeenCalledWith(`pika-checkout-customer-${id}`)
    expect(f.provider.createSession).toHaveBeenCalledWith(expect.objectContaining({ attempt_id: id }), 'cus_test', `pika-checkout-session-${id}`)
    expect(f.provider.retrieveSession).toHaveBeenCalledWith(expect.objectContaining({ session_id: 'cs_test_abc' }))
    expect(f.store.finishCheckout).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'pending' }))
  })
  it('never writes to Stripe when the merchant account check fails', async () => {
    const f = fixture()
    vi.mocked(f.provider.assertAccount).mockRejectedValue(new CheckoutProviderContractError())
    expect((await f.start()).status).toBe('attention')
    expect(f.provider.createCustomer).not.toHaveBeenCalled()
    expect(f.provider.createSession).not.toHaveBeenCalled()
  })
  it('replays a persisted session without creating or re-reading retired catalog availability', async () => {
    const f = fixture(); await f.start()
    vi.mocked(f.store.getCheckoutOffering).mockRejectedValue(new Error('retired'))
    vi.mocked(f.provider.retrieveSession).mockResolvedValue({ ...f.open, status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_test', url: null })
    expect((await f.start()).status).toBe('synchronizing')
    expect(f.provider.createCustomer).toHaveBeenCalledTimes(1)
    expect(f.provider.createSession).toHaveBeenCalledTimes(1)
    expect(f.store.finishCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'bound', subscription_id: 'sub_test' }))
    f.row().access_confirmed = true
    expect((await f.service.getCheckout({ subjectUserId: user, attemptId: id }))?.status).toBe('active')
  })
  it('rejects a changed offering under the same operation', async () => {
    const f = fixture(); await f.start()
    await expect(f.service.startCheckout({ subjectUserId: user, offeringVersionId: lease, operationId: id })).rejects.toThrow('operation conflict')
    expect(f.provider.createSession).toHaveBeenCalledTimes(1)
  })
  it('does not bind a completed session whose payment remains pending', async () => {
    const f = fixture()
    vi.mocked(f.provider.retrieveSession).mockResolvedValue({ ...f.open, status: 'complete', subscriptionId: 'sub_test', url: null })
    expect((await f.start()).status).toBe('payment_pending')
    expect(f.store.finishCheckout).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'pending', payment_pending: true }))
  })
  it('never binds a different retrieved session identity', async () => {
    const f = fixture()
    vi.mocked(f.provider.retrieveSession).mockResolvedValue({ ...f.open, id: 'cs_test_foreign' })
    expect((await f.start()).status).toBe('attention')
    expect(f.store.finishCheckout).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'bound' }))
  })
  it('recovers an unknown session create using exactly the same idempotency key', async () => {
    const f = fixture()
    vi.mocked(f.store.saveCheckoutProgress).mockImplementationOnce(async request => {
      f.row().customer_id = request.customer_id!; return { status: 'saved' }
    }).mockRejectedValueOnce(new Error('connection lost'))
    await f.start()
    expect(f.row().session_id).toBeNull()
    await f.start()
    expect(f.provider.createSession).toHaveBeenCalledTimes(2)
    expect(vi.mocked(f.provider.createSession).mock.calls.map(call => call[2])).toEqual([
      `pika-checkout-session-${id}`, `pika-checkout-session-${id}`,
    ])
  })
  it('stops unknown writes before provider idempotency retention can expire', async () => {
    const f = fixture()
    vi.mocked(f.provider.createSession).mockRejectedValueOnce(new Error('timeout'))
    await f.start()
    f.row().write_deadline = new Date(at - 1).toISOString()
    expect((await f.start()).status).toBe('attention')
    expect(f.provider.createSession).toHaveBeenCalledTimes(1)
    expect(f.store.finishCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ reason_code: 'write_recovery_expired' }))
  })
  it('stops on a lost progress lease before another provider mutation', async () => {
    const f = fixture()
    vi.mocked(f.store.saveCheckoutProgress).mockResolvedValueOnce({ status: 'lost_claim' })
    await f.start()
    expect(f.provider.createSession).not.toHaveBeenCalled()
  })
  it('returns null for a foreign account and rejects malformed work bounds', async () => {
    const f = fixture(); await f.start()
    expect(await f.service.getCheckout({ subjectUserId: lease, attemptId: id })).toBeNull()
    await expect(f.service.reconcileCheckouts({ limit: 11 })).rejects.toThrow()
    expect(f.store.listCheckoutWork).not.toHaveBeenCalled()
  })
  it('rejects hosted return destinations and unmapped offering terms', async () => {
    const f = fixture()
    expect(() => createCheckoutService({ store: f.store, provider: f.provider, stripeAccount: 'acct_test',
      returnOrigin: 'https://evil.example', validateOffering: () => null })).toThrow('isolated local')
    vi.mocked(f.store.getCheckoutOffering).mockResolvedValue({ ...offering, catalog_key: 'unknown' })
    await expect(f.start()).rejects.toThrow('approved launch catalog')
    expect(f.provider.createCustomer).not.toHaveBeenCalled()
  })
})
