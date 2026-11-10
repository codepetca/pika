import { describe, it, expect, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createPortalSession, verifyPortalConfiguration, type PortalPort } from '@/lib/server/billing/portal-provider'
import { createBillingPortalHandler } from '@/lib/server/billing/portal-handlers'
import { readBillingPortalConfig } from '@/lib/server/billing/portal-config'

const userId = '2a41e3d8-4ee2-4426-987f-d7468d2fd9d7'
const input = { userId, account: 'acct_123', configurationId: 'bpc_123', returnUrl: 'http://localhost:3000/billing' }
const binding = { subject_user_id: userId, stripe_account: input.account, provider_mode: 'test', stripe_customer_id: 'cus_123' }
const config = { id: 'bpc_123', object: 'billing_portal.configuration', active: true, livemode: false, features: {
  invoice_history: { enabled: true }, payment_method_update: { enabled: true },
  subscription_cancel: { enabled: false }, subscription_update: { enabled: false },
} }
const session = { object: 'billing_portal.session', customer: 'cus_123', configuration: 'bpc_123', livemode: false,
  return_url: input.returnUrl, url: 'https://billing.stripe.com/p/session?secret=test_123' }
function port(): PortalPort {
  return { getCustomer: vi.fn().mockResolvedValue(binding), getAccount: vi.fn().mockResolvedValue({ id: input.account }),
    getConfiguration: vi.fn().mockResolvedValue(config), createSession: vi.fn().mockResolvedValue(session) }
}

describe('portal provider', () => {
  it('uses only the bound customer and explicit configuration', async () => {
    const p = port()
    expect(await createPortalSession(p, input)).toBe(session.url)
    expect(p.createSession).toHaveBeenCalledWith({ customer: 'cus_123', configuration: 'bpc_123', return_url: input.returnUrl })
  })
  it.each([
    { ...binding, subject_user_id: 'e04d0394-29d0-43c7-a6f2-1ab91df07762' },
    { ...binding, stripe_account: 'acct_other' }, { ...binding, provider_mode: 'live' }, null,
  ])('rejects other or missing customer bindings', async value => {
    const p = port(); p.getCustomer = vi.fn().mockResolvedValue(value)
    await expect(createPortalSession(p, input)).rejects.toThrow()
    expect(p.createSession).not.toHaveBeenCalled()
  })
  it.each([
    { ...config, id: 'bpc_other' }, { ...config, livemode: true }, { ...config, active: false },
    { ...config, features: { ...config.features, subscription_update: { enabled: true } } },
    { ...config, features: { ...config.features, subscription_cancel: { enabled: true } } },
    { ...config, features: { ...config.features, invoice_history: { enabled: false } } },
    { ...config, features: { ...config.features, payment_method_update: { enabled: false } } },
  ])('rejects unsafe configuration', async value => {
    const p = port(); p.getConfiguration = vi.fn().mockResolvedValue(value)
    await expect(createPortalSession(p, input)).rejects.toThrow()
    expect(p.createSession).not.toHaveBeenCalled()
  })
  it('rejects account mismatch', async () => {
    const p = port(); p.getAccount = vi.fn().mockResolvedValue({ id: 'acct_other' })
    await expect(createPortalSession(p, input)).rejects.toThrow()
    expect(p.createSession).not.toHaveBeenCalled()
  })
  it.each(['http://billing.stripe.com/p', 'https://billing.stripe.com.evil.test/p', 'https://user@billing.stripe.com/p', 'https://billing.stripe.com:444/p'])('rejects unsafe URL %s', async url => {
    const p = port(); p.createSession = vi.fn().mockResolvedValue({ ...session, url })
    await expect(createPortalSession(p, input)).rejects.toThrow()
  })
  it('rejects a session for a different customer or mode', async () => {
    const p = port(); p.createSession = vi.fn().mockResolvedValue({ ...session, customer: 'cus_other' })
    await expect(createPortalSession(p, input)).rejects.toThrow()
    p.createSession = vi.fn().mockResolvedValue({ ...session, livemode: true })
    await expect(createPortalSession(p, input)).rejects.toThrow()
  })
})

describe('live portal provider', () => {
  const liveInput = { ...input, providerMode: 'live' as const, returnUrl: 'https://pika.codepet.ca/billing' }
  const liveConfig = { ...config, livemode: true, features: { ...config.features,
    customer_update: { enabled: false }, subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' } } }
  const liveSession = { ...session, livemode: true, return_url: liveInput.returnUrl, flow: null }
  function livePort(): PortalPort {
    return { getCustomer: vi.fn().mockResolvedValue({ ...binding, provider_mode: 'live' }),
      getAccount: vi.fn().mockResolvedValue({ id: input.account }),
      getStripeCustomer: vi.fn().mockResolvedValue({ id: 'cus_123', livemode: true }),
      getConfiguration: vi.fn().mockResolvedValue(liveConfig), createSession: vi.fn().mockResolvedValue(liveSession) }
  }
  it('checks the live binding, customer, account and cancellation policy before issuing the bearer URL', async () => {
    const p = livePort()
    expect(await createPortalSession(p, liveInput)).toBe(liveSession.url)
    expect(p.getStripeCustomer).toHaveBeenCalledWith('cus_123')
    expect(p.createSession).toHaveBeenCalledWith({ customer: 'cus_123', configuration: 'bpc_123', return_url: liveInput.returnUrl })
  })
  it('allows only billing-address edits for the tax-ready portal and retains access while admissions pause', async () => {
    const p = livePort()
    await expect(verifyPortalConfiguration(p, { ...liveInput, requireBillingAddressUpdates: true })).rejects.toThrow()
    p.getConfiguration = vi.fn().mockResolvedValue({ ...liveConfig, features: { ...liveConfig.features,
      customer_update: { enabled: true, allowed_updates: ['address'] } } })
    await expect(verifyPortalConfiguration(p, { ...liveInput, requireBillingAddressUpdates: true })).resolves.toBeUndefined()
    await expect(createPortalSession(p, liveInput)).resolves.toBe(liveSession.url)
    p.getConfiguration = vi.fn().mockResolvedValue({ ...liveConfig, features: { ...liveConfig.features,
      customer_update: { enabled: true, allowed_updates: ['address', 'tax_id'] } } })
    await expect(createPortalSession(p, liveInput)).rejects.toThrow()
  })

  it.each([
    { ...liveConfig, livemode: false },
    { ...liveConfig, features: { ...liveConfig.features, customer_update: { enabled: true } } },
    { ...liveConfig, features: { ...liveConfig.features, customer_update: undefined } },
    { ...liveConfig, features: { ...liveConfig.features, subscription_update: { enabled: true } } },
    { ...liveConfig, features: { ...liveConfig.features, subscription_cancel: { enabled: false, mode: 'at_period_end', proration_behavior: 'none' } } },
    { ...liveConfig, features: { ...liveConfig.features, subscription_cancel: { enabled: true, mode: 'immediately', proration_behavior: 'none' } } },
    { ...liveConfig, features: { ...liveConfig.features, subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'create_prorations' } } },
    { ...liveConfig, features: { ...liveConfig.features, subscription_cancel: { ...liveConfig.features.subscription_cancel, retention: { type: 'coupon_offer' } } } },
    { ...liveConfig, features: { ...liveConfig.features, subscription_cancel: { ...liveConfig.features.subscription_cancel, coupon: 'coupon_123' } } },
  ])('rejects unsafe live configuration before creating a session %#', async value => {
    const p = livePort(); p.getConfiguration = vi.fn().mockResolvedValue(value)
    await expect(createPortalSession(p, liveInput)).rejects.toThrow()
    expect(p.createSession).not.toHaveBeenCalled()
  })
  it('rejects foreign, test, deleted and missing live customer evidence', async () => {
    for (const value of [{ id: 'cus_other', livemode: true }, { id: 'cus_123', livemode: false }, { id: 'cus_123', deleted: true }, null]) {
      const p = livePort(); p.getStripeCustomer = vi.fn().mockResolvedValue(value)
      await expect(createPortalSession(p, liveInput)).rejects.toThrow()
      expect(p.createSession).not.toHaveBeenCalled()
    }
  })
  it('rejects noncanonical return URLs, wrong customer mode, wrong account and retention flows', async () => {
    const p = livePort()
    await expect(createPortalSession(p, { ...liveInput, returnUrl: 'https://example.test/billing' })).rejects.toThrow()
    expect(p.getCustomer).not.toHaveBeenCalled()
    p.getCustomer = vi.fn().mockResolvedValue(binding)
    await expect(createPortalSession(p, liveInput)).rejects.toThrow()
    p.getCustomer = vi.fn().mockResolvedValue({ ...binding, provider_mode: 'live' })
    p.getAccount = vi.fn().mockResolvedValue({ id: 'acct_foreign' })
    await expect(createPortalSession(p, liveInput)).rejects.toThrow()
    p.getAccount = vi.fn().mockResolvedValue({ id: input.account })
    p.createSession = vi.fn().mockResolvedValue({ ...liveSession, flow: { subscription_cancel: { retention: { type: 'coupon_offer' } } } })
    await expect(createPortalSession(p, liveInput)).rejects.toThrow()
  })
  it('rejects mismatched live portal session mode and return URL', async () => {
    const p = livePort()
    for (const change of [{ livemode: false }, { return_url: 'https://example.test' }, { configuration: 'bpc_other' }, { customer: 'cus_other' }, { flow: undefined }]) {
      p.createSession = vi.fn().mockResolvedValue({ ...liveSession, ...change })
      await expect(createPortalSession(p, liveInput)).rejects.toThrow()
    }
  })
})

describe('portal handler', () => {
  const ctx = { params: Promise.resolve({}) }
  const request = (origin = 'http://localhost:3000') => new NextRequest('http://localhost:3000/api/billing/portal', { method: 'POST', headers: { origin } })
  function setup() {
    const deps = { configuration: vi.fn((): { appOrigin: string } | null => ({ appOrigin: 'http://localhost:3000' })),
      authenticate: vi.fn().mockResolvedValue({ id: userId }), open: vi.fn().mockResolvedValue(session.url) }
    return { deps, handler: createBillingPortalHandler(deps) }
  }
  it('returns a private URL for the authenticated user', async () => {
    const { deps, handler } = setup(); const result = await handler(request(), ctx)
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ url: session.url })
    expect(result.headers.get('cache-control')).toBe('private, no-store'); expect(deps.open).toHaveBeenCalledWith(userId)
  })
  it('is off before authentication when configuration is absent', async () => {
    const { deps, handler } = setup(); deps.configuration.mockReturnValue(null)
    const result = await handler(request(), ctx)
    expect(result.status).toBe(404); expect(result.headers.get('cache-control')).toBe('private, no-store')
    expect(deps.authenticate).not.toHaveBeenCalled(); expect(deps.open).not.toHaveBeenCalled()
  })
  it('rejects missing or different origin and does not open a session', async () => {
    const { deps, handler } = setup(); const result = await handler(request('https://evil.test'), ctx)
    expect(result.status).toBe(403); expect(deps.open).not.toHaveBeenCalled()
    expect(result.headers.get('cache-control')).toBe('private, no-store')
  })
  it('returns private generic auth and provider errors', async () => {
    const { deps, handler } = setup(); const authError = new Error('private'); authError.name = 'AuthenticationError'
    deps.authenticate.mockRejectedValueOnce(authError)
    let result = await handler(request(), ctx); expect(result.status).toBe(401); expect(await result.json()).toEqual({ error: 'Unauthorized' })
    const forbidden = new Error('private'); forbidden.name = 'AuthorizationError'
    deps.authenticate.mockRejectedValueOnce(forbidden)
    result = await handler(request(), ctx); expect(result.status).toBe(403); expect(await result.json()).toEqual({ error: 'Forbidden' })
    deps.open.mockRejectedValueOnce(new Error('provider secret'))
    result = await handler(request(), ctx); expect(result.status).toBe(500); expect(await result.json()).toEqual({ error: 'Internal server error' })
    expect(result.headers.get('cache-control')).toBe('private, no-store')
  })
})


describe('portal configuration', () => {
  it('defaults off without an explicit configuration and retains purchase sandbox gates', () => {
    expect(readBillingPortalConfig({})).toBeNull()
    expect(readBillingPortalConfig({ BILLING_PORTAL_CONFIGURATION_ID: 'bpc_123' })).toBeNull()
    expect(readBillingPortalConfig({ BILLING_PORTAL_CONFIGURATION_ID: 'invalid' })).toBeNull()
    const sandbox = {
      BILLING_SANDBOX_ENABLED: 'true', BILLING_CHECKOUT_ENABLED: 'true',
      BILLING_APP_ORIGIN: 'http://localhost:3000', NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
      STRIPE_SECRET_KEY: 'sk_test_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_ACCOUNT_ID: 'acct_fixture', BILLING_WORKER_SECRET: 'fixture'.repeat(6),
    }
    expect(() => readBillingPortalConfig({ ...sandbox, BILLING_PORTAL_CONFIGURATION_ID: 'invalid' })).toThrow('Invalid portal configuration')
    expect(readBillingPortalConfig({ ...sandbox, BILLING_PORTAL_CONFIGURATION_ID: 'bpc_123' }))
      .toMatchObject({ portalConfigurationId: 'bpc_123', appOrigin: 'http://localhost:3000' })
  })
})

describe('live portal configuration', () => {
  const live = { BILLING_LIVE_PAYMENT_LIFECYCLE_ENABLED: 'true', VERCEL: '1', VERCEL_ENV: 'production',
    NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca', NEXT_PUBLIC_SUPABASE_URL: 'https://zhioqbapgfcrronyuidm.supabase.co',
    STRIPE_LIVE_ACCOUNT_ID: 'acct_live', STRIPE_LIVE_SECRET_KEY: 'rk_live_DedicatedFixtureSecret',
    BILLING_LIVE_PAYMENT_WORKER_SECRET: 'worker-secret-'.repeat(4), BILLING_LIVE_PORTAL_CONFIGURATION_ID: 'bpc_Live' }
  it('uses the distinct live configuration while checkout admission and writes are paused', () => {
    expect(readBillingPortalConfig(live)).toMatchObject({ providerMode: 'live', portalConfigurationId: 'bpc_Live',
      stripeAccount: 'acct_live', checkoutAdmissionEnabled: false, providerWritesEnabled: false })
  })
  it('is disabled without live configuration and rejects invalid live target or configuration', () => {
    expect(readBillingPortalConfig({ ...live, BILLING_LIVE_PORTAL_CONFIGURATION_ID: '' })).toBeNull()
    expect(readBillingPortalConfig({ ...live, BILLING_LIVE_PAYMENT_LIFECYCLE_ENABLED: 'false' })).toBeNull()
    expect(() => readBillingPortalConfig({ ...live, BILLING_LIVE_PORTAL_CONFIGURATION_ID: 'bad' })).toThrow()
    expect(() => readBillingPortalConfig({ ...live, VERCEL_ENV: 'preview' })).toThrow()
    expect(() => readBillingPortalConfig({ ...live, BILLING_SANDBOX_ENABLED: 'true' })).toThrow()
  })
})
