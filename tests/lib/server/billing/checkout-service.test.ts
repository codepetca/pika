import { describe, expect, it, vi } from 'vitest'
import { createCheckoutService } from '@/lib/server/billing/checkout-service'
import { validateLaunchCheckoutOffering } from '@/lib/server/billing/purchase-catalog'
import { REPOLIGHT_CATALOG_RELEASE_TAG } from '@/lib/billing/launch-catalog'
import { CheckoutProviderContractError, type CheckoutAttempt, type CheckoutProvider, type CheckoutStore } from '@/lib/server/billing/checkout-contracts'

const user = 'a2100000-0000-4000-8000-000000000001'
const id = 'a2100000-0000-4000-8000-000000000002'
const version = 'a2100000-0000-4000-8000-000000000003'
const lease = 'a2100000-0000-4000-8000-000000000004'
const at = Date.parse('2026-09-26T12:00:00Z')
const offering = { offering_version_id: version, plan_key: 'plus' as const, stripe_account: 'acct_test',
  stripe_product_id: 'prod_test', stripe_price_id: 'price_test', currency: 'usd' as const, interval: 'month' as const,
  unit_amount: 1900, classroom_limit: 5, catalog_key: 'pika:launch-2026-09-26:pro:usd:month' }
function fixture(providerMode: 'test' | 'live' = 'test', now = () => at) {
  let row: CheckoutAttempt | null = null
  const sequence: string[] = []
  const store: CheckoutStore = {
    getCheckoutOffering: vi.fn(async () => providerMode === 'live' ? { ...offering, provider_mode: 'live' } : offering),
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
        : request.outcome === 'retry' || request.outcome === 'paused' ? row!.status : request.outcome
      return { status: 'finished' }
    }),
    listCheckoutWork: vi.fn(async () => ({ attempt_ids: [id] })),
  }
  const open = { id: `cs_${providerMode}_abc`, customerId: 'cus_test', subscriptionId: null,
    status: 'open' as const, paymentStatus: 'unpaid' as const, url: 'https://checkout.stripe.com/c/pay/abc' }
  const provider: CheckoutProvider = {
    assertAccount: vi.fn(async () => { sequence.push('account') }),
    createCustomer: vi.fn(async (_key, authorize) => { await authorize?.(); sequence.push('customer'); return 'cus_test' }),
    createSession: vi.fn(async (_attempt, _customer, _key, authorize) => { await authorize?.(); sequence.push('session'); return open }),
    retrieveSession: vi.fn(async () => open),
  }
  const dependencies = { store, provider, stripeAccount: 'acct_test',
    validateOffering: candidate => candidate.catalog_key === offering.catalog_key ? { lookupKey: offering.catalog_key } : null,
    now } satisfies Pick<Parameters<typeof createCheckoutService>[0], 'store' | 'provider' | 'stripeAccount' | 'validateOffering' | 'now'>
  const authorizeProviderWrite = vi.fn(async () => { sequence.push('authorize'); return true })
  const liveService = (checkoutAdmissionEnabled: boolean, providerWritesEnabled: boolean, returnOrigin = 'https://pika.codepet.ca') =>
    createCheckoutService({ ...dependencies, providerMode: 'live', returnOrigin, checkoutAdmissionEnabled, providerWritesEnabled, authorizeProviderWrite })
  const service = providerMode === 'live' ? liveService(true, true)
    : createCheckoutService({ ...dependencies, returnOrigin: 'http://localhost:3000' })
  const start = () => service.startCheckout({ subjectUserId: user, offeringVersionId: version, operationId: id })
  return { store, provider, service, liveService, start, sequence, row: () => row!, open, authorizeProviderWrite }
}

describe('durable hosted checkout orchestration', () => {
  it('reauthorizes the exact lease before each live write and preserves customer progress on pause', async () => {
    const live = fixture('live')
    live.authorizeProviderWrite.mockImplementationOnce(async () => { live.sequence.push('authorize'); return true })
      .mockImplementationOnce(async () => { live.sequence.push('authorize'); return true })
      .mockImplementationOnce(async () => { live.sequence.push('authorize'); return false })

    await expect(live.start()).resolves.toMatchObject({ status: 'pending', checkoutUrl: null })
    expect(live.sequence).toEqual(['reserve', 'authorize', 'account', 'authorize', 'customer', 'authorize'])
    expect(live.authorizeProviderWrite).toHaveBeenCalledTimes(3)
    expect(live.authorizeProviderWrite).toHaveBeenCalledWith({ attempt_id: id, lease_token: lease, fencing_token: 1 })
    expect(live.row()).toMatchObject({ customer_id: 'cus_test', session_id: null })
    expect(live.store.finishCheckout).toHaveBeenLastCalledWith(expect.objectContaining({
      outcome: 'paused', reason_code: 'provider_writes_paused',
    }))

    await expect(live.start()).resolves.toMatchObject({ status: 'checkout_open' })
    expect(live.provider.createCustomer).toHaveBeenCalledOnce()
  })

  it('learns about a database-only write pause before any Stripe reads', async () => {
    const live = fixture('live')
    live.authorizeProviderWrite.mockResolvedValueOnce(false)
    await expect(live.start()).resolves.toMatchObject({ status: 'pending', checkoutUrl: null })
    expect(live.provider.assertAccount).not.toHaveBeenCalled()
    expect(live.provider.createCustomer).not.toHaveBeenCalled()
    expect(live.store.finishCheckout).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'paused' }))
  })

  it('binds live reservations to production and rejects a same-account sandbox offering', async () => {
    const live = fixture('live')
    expect(() => live.liveService(true, true, 'https://pika.codepet.ca.invalid')).toThrow('Invalid live checkout return origin')
    vi.mocked(live.store.getCheckoutOffering).mockResolvedValueOnce(offering)
    await expect(live.start()).rejects.toThrow('Checkout offering mismatch')
    expect(live.store.reserveCheckout).not.toHaveBeenCalled()
    expect(live.provider.createCustomer).not.toHaveBeenCalled()
    expect(await live.start()).toEqual({ attemptId: id, status: 'checkout_open', checkoutUrl: live.open.url })
    expect(live.store.reserveCheckout).toHaveBeenCalledWith(expect.objectContaining({
      success_url: `https://pika.codepet.ca/billing?checkout=${id}&result=success`,
      cancel_url: `https://pika.codepet.ca/billing?checkout=${id}&result=cancel`,
      offering: expect.objectContaining({ provider_mode: 'live' }),
    }))
    live.row().success_url = `https://pika.codepet.ca.invalid/billing?checkout=${id}&result=success`
    await expect(live.start()).rejects.toThrow('Checkout identity mismatch')
    expect(live.provider.createSession).toHaveBeenCalledTimes(1)
  })

  it('closes new admission without preventing recovery of a paid live session', async () => {
    const fresh = fixture('live')
    const args = { subjectUserId: user, offeringVersionId: version, operationId: id }
    await expect(fresh.liveService(false, true).startCheckout(args)).rejects.toThrow('New checkout is currently unavailable')
    expect(fresh.store.reserveCheckout).not.toHaveBeenCalled()

    const live = fixture('live')
    await live.start()
    vi.mocked(live.provider.retrieveSession).mockResolvedValue({ ...live.open,
      status: 'complete', paymentStatus: 'paid', subscriptionId: 'sub_live', url: null })
    const paused = live.liveService(false, false)
    expect(await paused.reconcileCheckouts({ limit: 1 })).toEqual({ processed: 1, failed: 0 })
    expect(live.store.finishCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'bound', subscription_id: 'sub_live' }))
    expect(live.provider.createSession).toHaveBeenCalledTimes(1)

    live.row().session_id = null
    live.row().status = 'reserved'
    expect(await paused.reconcileCheckouts({ limit: 1 })).toEqual({ processed: 1, failed: 0 })
    expect(live.store.finishCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'paused', reason_code: 'provider_writes_paused' }))
    expect(live.provider.createSession).toHaveBeenCalledTimes(1)
  })

  it('closes a live attempt when provider reads consume its write window', async () => {
    let time = at
    const live = fixture('live', () => time)
    vi.mocked(live.provider.createSession).mockImplementationOnce(async (_attempt, _customer, _key, assertCanWrite) => {
      time = at + 120_000
      await assertCanWrite?.()
      throw new Error('Provider write should have stopped')
    })
    expect((await live.start()).status).toBe('attention')
    expect(live.store.finishCheckout).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'attention', reason_code: 'write_recovery_expired' }))
  })

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
  it('rejects a fresh historical offering but preserves retry and reconciliation of an existing attempt', async () => {
    const fresh = fixture()
    const currentService = createCheckoutService({ store: fresh.store, provider: fresh.provider, stripeAccount: 'acct_test',
      returnOrigin: 'http://localhost:3000', validateOffering: candidate => validateLaunchCheckoutOffering(candidate, REPOLIGHT_CATALOG_RELEASE_TAG), now: () => at })
    await expect(currentService.startCheckout({ subjectUserId: user, offeringVersionId: version, operationId: id })).rejects.toThrow('approved launch catalog')
    expect(fresh.store.reserveCheckout).not.toHaveBeenCalled()
    expect(fresh.provider.createCustomer).not.toHaveBeenCalled()

    const historical = fixture(); await historical.start()
    const resumed = createCheckoutService({ store: historical.store, provider: historical.provider, stripeAccount: 'acct_test',
      returnOrigin: 'http://localhost:3000', validateOffering: candidate => validateLaunchCheckoutOffering(candidate, REPOLIGHT_CATALOG_RELEASE_TAG), now: () => at })
    expect((await resumed.startCheckout({ subjectUserId: user, offeringVersionId: version, operationId: id })).status).toBe('checkout_open')
    expect(await resumed.reconcileCheckouts({ limit: 1 })).toEqual({ processed: 1, failed: 0 })
    expect(historical.store.getCheckoutOffering).toHaveBeenCalledTimes(1)
    expect(historical.provider.createSession).toHaveBeenCalledTimes(1)
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
  it('does not issue a provider write when its checkout lease lacks the recovery buffer', async () => {
    const f = fixture()
    // Reserve first so the claimed attempt is a real persisted row.
    vi.mocked(f.store.claimCheckout).mockImplementationOnce(async () => ({
      status: 'claimed', attempt: {
        attempt_id: id, subject_user_id: user, offering, lookup_key: offering.catalog_key,
        status: 'reserved', customer_id: null, session_id: null, checkout_url: null,
        success_url: `http://localhost:3000/billing?checkout=${id}&result=success`,
        cancel_url: `http://localhost:3000/billing?checkout=${id}&result=cancel`,
        created_at: new Date(at).toISOString(), write_deadline: new Date(at + 23 * 3600_000).toISOString(),
        access_confirmed: false,
      },
      lease_token: lease, fencing_token: 1, lease_expires_at: new Date(at + 9_000).toISOString(),
    }))

    expect((await f.start()).status).toBe('attention')
    expect(f.provider.createCustomer).not.toHaveBeenCalled()
    expect(f.provider.createSession).not.toHaveBeenCalled()
    expect(f.store.finishCheckout).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'attention', reason_code: 'write_recovery_expired',
    }))
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
