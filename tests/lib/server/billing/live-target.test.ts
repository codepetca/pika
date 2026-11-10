import { describe, expect, it, vi } from 'vitest'
import { checkBillingLiveTarget, readBillingLiveCheckoutConfig, readBillingLivePaymentWorkerConfig, readBillingLiveScheduledChangeConfig, readBillingLiveTrialConfig } from '@/lib/server/billing/live-target'

const projectRef = 'zhioqbapgfcrronyuidm'
const supabaseOrigin = 'https://' + projectRef + '.supabase.co'
const stripeAccount = 'acct_Preflight311'
const environment = {
  BILLING_LIVE_TARGET_CHECK_ENABLED: 'true',
  VERCEL: '1',
  VERCEL_ENV: 'production',
  NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca',
  NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin,
  STRIPE_LIVE_ACCOUNT_ID: stripeAccount,
}
const rpcPath = '/rest/v1/rpc/billing_attest_live_target_v1'
const requestUrl = supabaseOrigin + rpcPath + '?p_project_ref=' + projectRef + '&p_stripe_account=' + stripeAccount

describe('live checkout configuration', () => {
  const recovery = { ...environment, BILLING_LIVE_PAYMENT_LIFECYCLE_ENABLED: 'true',
    STRIPE_LIVE_SECRET_KEY: 'rk_live_DedicatedFixtureSecret' }

  it('defaults off and can keep recovery on while new admission and Stripe writes are off', () => {
    expect(readBillingLiveCheckoutConfig({})).toBeNull()
    expect(readBillingLiveCheckoutConfig(recovery)).toMatchObject({ projectRef, stripeAccount, supabaseOrigin,
      providerMode: 'live', checkoutAdmissionEnabled: false, providerWritesEnabled: false })
  })

  it.each([
    { STRIPE_LIVE_SECRET_KEY: 'sk_test_OtherModeSecretFixture' },
    { BILLING_SANDBOX_ENABLED: 'true' },
    { VERCEL_ENV: 'preview' },
    { BILLING_LIVE_PAYMENT_LIFECYCLE_ENABLED: 'false', BILLING_LIVE_CHECKOUT_WRITES_ENABLED: 'true' },
    { BILLING_LIVE_PAYMENT_LIFECYCLE_ENABLED: 'false', BILLING_LIVE_CHECKOUT_ADMISSION_ENABLED: 'true' },
  ])('rejects unsafe configuration', overrides => {
    expect(() => readBillingLiveCheckoutConfig({ ...recovery, ...overrides })).toThrow(/Invalid live/)
  })

  it('keeps paid recovery available with admission off and requires an independent worker and signed ingress for admission', () => {
    const payment = { ...recovery, BILLING_LIVE_CHECKOUT_ADMISSION_ENABLED: 'true', BILLING_LIVE_CHECKOUT_WRITES_ENABLED: 'true',
      BILLING_LIVE_PAYMENT_WORKER_SECRET: 'live-payment-worker'.repeat(3) }
    expect(readBillingLivePaymentWorkerConfig(payment)?.checkoutAdmissionEnabled).toBe(false)
    expect(readBillingLivePaymentWorkerConfig({ ...payment, BILLING_LIVE_WEBHOOK_ENABLED: 'true', STRIPE_LIVE_WEBHOOK_SECRET: 'bad' })?.checkoutAdmissionEnabled).toBe(false)
    expect(readBillingLiveCheckoutConfig({ ...payment, BILLING_LIVE_PORTAL_CONFIGURATION_ID: 'invalid' })?.portalConfigurationId).toBeUndefined()
    expect(readBillingLiveCheckoutConfig({ ...payment, BILLING_LIVE_PORTAL_CONFIGURATION_ID: 'bpc_Live' })?.portalConfigurationId).toBe('bpc_Live')
    const webhook = { ...payment, BILLING_LIVE_WEBHOOK_ENABLED: 'true', STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_LiveFixtureSigningSecret' }
    expect(readBillingLivePaymentWorkerConfig(webhook)?.checkoutAdmissionEnabled).toBe(false)
    expect(readBillingLivePaymentWorkerConfig({ ...webhook, BILLING_LIVE_PORTAL_CONFIGURATION_ID: 'invalid' })?.checkoutAdmissionEnabled).toBe(false)
    expect(readBillingLivePaymentWorkerConfig({ ...webhook, BILLING_LIVE_PORTAL_CONFIGURATION_ID: 'bpc_Live' })?.checkoutAdmissionEnabled).toBe(true)
    expect(() => readBillingLivePaymentWorkerConfig({ ...payment,
      BILLING_LIVE_TRIAL_WORKER_SECRET: payment.BILLING_LIVE_PAYMENT_WORKER_SECRET })).toThrow(/worker configuration/)
    expect(() => readBillingLivePaymentWorkerConfig({ ...payment,
      STRIPE_LIVE_WEBHOOK_SECRET: payment.BILLING_LIVE_PAYMENT_WORKER_SECRET })).toThrow(/worker configuration/)
  })
})

describe('live scheduled change admission configuration', () => {
  const scheduled = { ...environment, BILLING_LIVE_PAYMENT_LIFECYCLE_ENABLED: 'true',
    STRIPE_LIVE_SECRET_KEY: 'rk_live_DedicatedFixtureSecret',
    BILLING_LIVE_PAYMENT_WORKER_SECRET: 'live-payment-worker'.repeat(3),
    BILLING_LIVE_WEBHOOK_ENABLED: 'true', STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_LiveFixtureSigningSecret',
    BILLING_LIVE_SCHEDULED_CHANGES_ENABLED: 'true', BILLING_LIVE_SCHEDULED_INSTALLATION_ENABLED: 'true',
    BILLING_LIVE_SCHEDULED_CANCELLATION_ENABLED: 'true', BILLING_LIVE_SCHEDULED_CLOSEOUT_ENABLED: 'true' }

  it('requires each scheduled lane and valid webhook configuration while leaving payment recovery independent', () => {
    expect(readBillingLiveScheduledChangeConfig({})).toBeNull()
    expect(readBillingLiveScheduledChangeConfig(scheduled)).toMatchObject({ projectRef, stripeAccount, supabaseOrigin })
    for (const gate of ['CHANGES', 'INSTALLATION', 'CANCELLATION', 'CLOSEOUT']) {
      const paused = { ...scheduled, [`BILLING_LIVE_SCHEDULED_${gate}_ENABLED`]: 'false' }
      expect(readBillingLiveScheduledChangeConfig(paused)).toBeNull()
      expect(readBillingLivePaymentWorkerConfig(paused)).not.toBeNull()
    }
    expect(readBillingLiveScheduledChangeConfig({ ...scheduled, BILLING_LIVE_WEBHOOK_ENABLED: 'false' })).toBeNull()
    expect(() => readBillingLiveScheduledChangeConfig({ ...scheduled, STRIPE_LIVE_WEBHOOK_SECRET: 'invalid' })).toThrow(/webhook configuration/)
  })
})

describe('live trial runtime configuration', () => {
  const trial = {
    ...environment,
    BILLING_LIVE_TARGET_CHECK_ENABLED: 'false',
    BILLING_LIVE_TRIAL_LIFECYCLE_ENABLED: 'true',
    BILLING_LIVE_TRIAL_WORKER_SECRET: 'worker-secret'.repeat(3),
  }

  it('allows recovery while admission is off without Stripe credentials', () => {
    expect(readBillingLiveTrialConfig({})).toBeNull()
    expect(readBillingLiveTrialConfig(trial)).toEqual({
      projectRef, stripeAccount, supabaseOrigin,
      appOrigin: environment.NEXT_PUBLIC_APP_URL,
      workerSecret: trial.BILLING_LIVE_TRIAL_WORKER_SECRET,
      admissionEnabled: false,
    })
    expect(readBillingLiveTrialConfig({ ...trial, BILLING_LIVE_TRIAL_ADMISSION_ENABLED: 'true' })?.admissionEnabled)
      .toBe(true)
  })

  it.each([
    { BILLING_SANDBOX_ENABLED: 'true' },
    { VERCEL_ENV: 'preview' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' },
    { STRIPE_LIVE_ACCOUNT_ID: undefined, STRIPE_ACCOUNT_ID: 'acct_Sandbox311' },
    { BILLING_LIVE_TRIAL_WORKER_SECRET: 'short' },
    { BILLING_LIVE_TRIAL_LIFECYCLE_ENABLED: 'false', BILLING_LIVE_TRIAL_ADMISSION_ENABLED: 'true' },
  ])('rejects an invalid live trial boundary', (overrides) => {
    expect(() => readBillingLiveTrialConfig({ ...trial, ...overrides })).toThrow(/Invalid live/)
  })
})

describe('dormant live billing target check', () => {
  it('defaults off before building any transport', async () => {
    const read = vi.fn()
    await expect(checkBillingLiveTarget({ environment: {}, read })).resolves.toBe('disabled')
    await expect(checkBillingLiveTarget({
      environment: { ...environment, BILLING_LIVE_TARGET_CHECK_ENABLED: 'false' }, read,
    })).resolves.toBe('disabled')
    expect(read).not.toHaveBeenCalled()
  })

  it.each([
    { BILLING_SANDBOX_ENABLED: 'true' },
    { VERCEL: undefined },
    { VERCEL_ENV: 'preview' },
    { VERCEL_TARGET_ENV: 'preview' },
    { NEXT_PUBLIC_APP_URL: 'http://pika.codepet.ca' },
    { NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca.attacker.invalid' },
    { NEXT_PUBLIC_APP_URL: 'https://pika.codepet.ca/billing' },
    { NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://' + 'b'.repeat(20) + '.supabase.co' },
    { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + ':443' },
    { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + '/rest/v1' },
    { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + '?redirect=elsewhere' },
    { NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + '#' },
    { STRIPE_LIVE_ACCOUNT_ID: 'malformed' },
    { STRIPE_LIVE_ACCOUNT_ID: undefined, STRIPE_ACCOUNT_ID: 'acct_Sandbox311' },
  ])('rejects a conflicting or unsafe environment before the reader is called', async override => {
    const read = vi.fn()
    await expect(checkBillingLiveTarget({ environment: { ...environment, ...override }, read }))
      .resolves.toBe('invalid_target')
    expect(read).not.toHaveBeenCalled()
  })

  it('attests only the exact production identity using a GET without redirects', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('true'))
    const result = await checkBillingLiveTarget({
      environment: { ...environment, NEXT_PUBLIC_SUPABASE_URL: supabaseOrigin + '/' },
      fetchImpl,
      async read(args, fetchRead) {
        expect(args).toEqual({ p_project_ref: projectRef, p_stripe_account: stripeAccount })
        return (await fetchRead(requestUrl)).json()
      },
    })
    expect(result).toBe('attested')
    expect(fetchImpl).toHaveBeenCalledOnce()
    expect(fetchImpl).toHaveBeenCalledWith(requestUrl, expect.objectContaining({
      redirect: 'manual', signal: expect.any(AbortSignal),
    }))
  })

  it.each([
    [requestUrl, { method: 'POST' }],
    [requestUrl, { body: '{}' }],
    [requestUrl.replace('/rpc/', '/other/'), undefined],
    [requestUrl.replace(supabaseOrigin, 'https://other.invalid'), undefined],
    [requestUrl.replace(stripeAccount, 'acct_Other311'), undefined],
    [requestUrl + '&p_stripe_account=acct_Other311', undefined],
    [requestUrl + '&extra=value', undefined],
    [requestUrl + '#fragment', undefined],
  ] as const)('rejects any request outside the single read contract', async (url, init) => {
    const fetchImpl = vi.fn<typeof fetch>()
    await expect(checkBillingLiveTarget({
      environment,
      fetchImpl,
      async read(_args, fetchRead) {
        await fetchRead(url, init)
        return true
      },
    })).resolves.toBe('unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed on redirects, transport errors and non-boolean replies', async () => {
    await expect(checkBillingLiveTarget({
      environment,
      fetchImpl: async () => new Response(null, { status: 302 }),
      async read(_args, fetchRead) {
        await fetchRead(requestUrl)
        return true
      },
    })).resolves.toBe('unavailable')
    const failedRead = vi.fn().mockRejectedValue(new Error('private diagnostic'))
    await expect(checkBillingLiveTarget({ environment, read: failedRead })).resolves.toBe('unavailable')
    for (const value of [false, null, { attested: true }, 'true']) {
      await expect(checkBillingLiveTarget({ environment, read: async () => value })).resolves.toBe('unavailable')
    }
  })
})
