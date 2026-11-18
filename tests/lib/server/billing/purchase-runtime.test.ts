import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  taxReady: vi.fn(), rpc: vi.fn(), rpcResult: vi.fn(), service: vi.fn(), list: vi.fn(), verify: vi.fn(),
  stripe: { accounts: { retrieve: vi.fn() }, billingPortal: { configurations: { retrieve: vi.fn() } } },
  store: { listOfferings: vi.fn(), authorizeProviderWrite: vi.fn() },
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/server/supabase-target', () => ({ createTargetBoundFetch: () => vi.fn() }))
vi.mock('@/lib/server/billing/runtime', () => ({ createBillingStripeClient: () => mocks.stripe }))
vi.mock('@/lib/server/billing/stripe-checkout-provider', () => ({ createStripeCheckoutPort: () => ({}), createStripeCheckoutProvider: () => ({}) }))
vi.mock('@/lib/server/billing/purchase-store', () => ({ createLiveBillingPurchaseStore: () => mocks.store, createBillingPurchaseStore: () => mocks.store }))
vi.mock('@/lib/server/billing/checkout-service', () => ({ createCheckoutService: mocks.service }))
vi.mock('@/lib/server/billing/purchase-catalog', () => ({ listLaunchPurchaseCatalog: mocks.list, validateLaunchCheckoutOffering: vi.fn() }))
vi.mock('@/lib/server/billing/stripe-tax-readiness', () => ({ isStripeTaxReady: mocks.taxReady }))
vi.mock('@/lib/server/billing/portal-provider', () => ({ verifyPortalConfiguration: mocks.verify }))
import { createBillingPurchaseRuntime } from '@/lib/server/billing/purchase-runtime'

const config = { providerMode: 'live' as const, projectRef: 'zhioqbapgfcrronyuidm', stripeAccount: 'acct_Live',
  supabaseOrigin: 'https://zhioqbapgfcrronyuidm.supabase.co', appOrigin: 'https://pika.codepet.ca' as const,
  secretKey: 'rk_live_fixture', portalConfigurationId: 'bpc_Live', checkoutAdmissionEnabled: true, providerWritesEnabled: true }
let authorize: () => Promise<boolean>
beforeEach(() => {
  vi.resetAllMocks()
  delete process.env.BILLING_LIVE_STRIPE_TAX_ADMISSION_ENABLED
  mocks.taxReady.mockResolvedValue(true)
  mocks.rpc.mockReturnValue({ abortSignal: mocks.rpcResult })
  mocks.rpcResult.mockResolvedValue({ data: true, error: null })
  mocks.verify.mockResolvedValue(undefined)
  mocks.list.mockResolvedValue([])
  mocks.service.mockImplementation(input => {
    authorize = input.authorizeNewCheckout
    return { reconcileCheckouts: vi.fn() }
  })
})

describe('live purchase portal admission', () => {
  it('requires tax readiness only when the tax admission flag is enabled', async () => {
    process.env.BILLING_LIVE_STRIPE_TAX_ADMISSION_ENABLED = 'true'
    const runtime = createBillingPurchaseRuntime(config)
    mocks.taxReady.mockResolvedValue(false)
    expect(await authorize()).toBe(false)
    expect(await runtime.listCatalog('unused')).toEqual([])
    expect(mocks.list).not.toHaveBeenCalled()
    mocks.taxReady.mockResolvedValue(true)
    expect(await authorize()).toBe(true)
    await runtime.listCatalog('unused')
    expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ taxMode: 'stripe_exclusive' }))
    delete process.env.BILLING_LIVE_STRIPE_TAX_ADMISSION_ENABLED
  })
  it('checks exact database activation before each fresh portal verification and catalog lookup', async () => {
    const runtime = createBillingPurchaseRuntime(config)
    expect(await authorize()).toBe(true)
    expect(await runtime.listCatalog('unused')).toEqual([])
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    expect(mocks.verify).toHaveBeenCalledTimes(2)
    expect(mocks.rpc).toHaveBeenCalledWith('billing_live_checkout_activation_ready_v1', { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount })
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.verify.mock.invocationCallOrder[0])
    expect(mocks.verify).toHaveBeenLastCalledWith(expect.any(Object), { account: config.stripeAccount, configurationId: 'bpc_Live', providerMode: 'live' })
  })
  it.each([{ data: false, error: null }, { data: null, error: { code: 'fault' } }])('does not read Stripe or list offers when activation is unavailable %#', async result => {
    mocks.rpcResult.mockResolvedValue(result)
    const runtime = createBillingPurchaseRuntime(config)
    expect(await authorize()).toBe(false)
    expect(await runtime.listCatalog('unused')).toEqual([])
    expect(mocks.verify).not.toHaveBeenCalled()
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('hides offers and rejects new checkout if DB transport or portal verification fails', async () => {
    const runtime = createBillingPurchaseRuntime(config)
    mocks.rpcResult.mockRejectedValueOnce(new Error('offline'))
    expect(await authorize()).toBe(false)
    expect(mocks.verify).not.toHaveBeenCalled()
    mocks.verify.mockRejectedValue(new Error('configuration unavailable'))
    expect(await authorize()).toBe(false)
    expect(await runtime.listCatalog('unused')).toEqual([])
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('does not read database or Stripe when portal is missing or new writes are paused', async () => {
    for (const changes of [{ portalConfigurationId: undefined }, { checkoutAdmissionEnabled: false }, { providerWritesEnabled: false }]) {
      const runtime = createBillingPurchaseRuntime({ ...config, ...changes })
      expect(await authorize()).toBe(false)
      expect(await runtime.listCatalog('unused')).toEqual([])
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.verify).not.toHaveBeenCalled()
  })
})
