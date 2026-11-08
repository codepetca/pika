import { createTargetBoundFetch, verifyHostedSupabaseApiOrigin } from '@/lib/server/supabase-target'

// These identify Pika's production target independently of caller-supplied URLs.
export const PRODUCTION_APP_ORIGIN = 'https://pika.codepet.ca'
const PRODUCTION_PROJECT_REF = 'zhioqbapgfcrronyuidm'

type BillingLiveTargetConfig = Readonly<{
  projectRef: string
  stripeAccount: string
  supabaseOrigin: string
}>

type LiveTargetRpcArgs = {
  p_project_ref: string
  p_stripe_account: string
}

export type BillingLiveTargetStatus = 'disabled' | 'invalid_target' | 'unavailable' | 'attested'

function readExactLiveBillingTarget(env: NodeJS.ProcessEnv): BillingLiveTargetConfig {
  const stripeAccount = env.STRIPE_LIVE_ACCOUNT_ID
  if (
    env.BILLING_SANDBOX_ENABLED === 'true'
    || env.VERCEL !== '1'
    || env.VERCEL_ENV !== 'production'
    || (env.VERCEL_TARGET_ENV !== undefined && env.VERCEL_TARGET_ENV !== 'production')
    || env.NEXT_PUBLIC_APP_URL !== PRODUCTION_APP_ORIGIN
    || !stripeAccount
    || !/^acct_[A-Za-z0-9]{1,255}$/.test(stripeAccount)
    || !env.NEXT_PUBLIC_SUPABASE_URL
  ) {
    throw new Error('Invalid live billing target')
  }
  let supabaseOrigin: string
  try {
    supabaseOrigin = verifyHostedSupabaseApiOrigin(env.NEXT_PUBLIC_SUPABASE_URL, PRODUCTION_PROJECT_REF)
  } catch {
    throw new Error('Invalid live billing target')
  }
  if (env.NEXT_PUBLIC_SUPABASE_URL !== supabaseOrigin && env.NEXT_PUBLIC_SUPABASE_URL !== supabaseOrigin + '/') {
    throw new Error('Invalid live billing target')
  }
  return { projectRef: PRODUCTION_PROJECT_REF, stripeAccount, supabaseOrigin }
}

export type BillingLiveTrialConfig = BillingLiveTargetConfig & Readonly<{
  appOrigin: string
  workerSecret: string
  admissionEnabled: boolean
}>

/** Ingress only needs its signing secret. It cannot call the Stripe API. */
export function readBillingLiveWebhookConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.BILLING_LIVE_WEBHOOK_ENABLED !== 'true') return null
  const target = readExactLiveBillingTarget(env)
  const webhookSecret = env.STRIPE_LIVE_WEBHOOK_SECRET
  if (!webhookSecret || !/^whsec_[A-Za-z0-9]{16,255}$/.test(webhookSecret)
    || webhookSecret === env.STRIPE_WEBHOOK_SECRET) {
    throw new Error('Invalid live webhook configuration')
  }
  return { ...target, webhookSecret }
}

export type BillingLiveCheckoutConfig = BillingLiveTargetConfig & Readonly<{
  providerMode: 'live'
  appOrigin: typeof PRODUCTION_APP_ORIGIN
  secretKey: string
  checkoutAdmissionEnabled: boolean
  providerWritesEnabled: boolean
}>

/** Keep recovery available while either admission or new provider writes is paused. */
export function readBillingLiveCheckoutConfig(env: NodeJS.ProcessEnv = process.env): BillingLiveCheckoutConfig | null {
  const checkoutAdmissionEnabled = env.BILLING_LIVE_CHECKOUT_ADMISSION_ENABLED === 'true'
  const providerWritesEnabled = env.BILLING_LIVE_CHECKOUT_WRITES_ENABLED === 'true'
  if (env.BILLING_LIVE_PAYMENT_LIFECYCLE_ENABLED !== 'true') {
    if (checkoutAdmissionEnabled || providerWritesEnabled) throw new Error('Invalid live checkout configuration')
    return null
  }
  const target = readExactLiveBillingTarget(env)
  const secretKey = env.STRIPE_LIVE_SECRET_KEY
  if (!secretKey || !/^(?:sk|rk)_live_[A-Za-z0-9]{16,255}$/.test(secretKey)) {
    throw new Error('Invalid live checkout configuration')
  }
  return { ...target, providerMode: 'live', appOrigin: PRODUCTION_APP_ORIGIN, secretKey,
    checkoutAdmissionEnabled, providerWritesEnabled }
}

/** Existing trial status and expiry stay available while new admission is stopped. */
export function readBillingLiveTrialConfig(env: NodeJS.ProcessEnv = process.env): BillingLiveTrialConfig | null {
  const admissionEnabled = env.BILLING_LIVE_TRIAL_ADMISSION_ENABLED === 'true'
  if (env.BILLING_LIVE_TRIAL_LIFECYCLE_ENABLED !== 'true') {
    if (admissionEnabled) throw new Error('Invalid live trial configuration')
    return null
  }
  const target = readExactLiveBillingTarget(env)
  const workerSecret = env.BILLING_LIVE_TRIAL_WORKER_SECRET
  if (!workerSecret || workerSecret.length < 32) throw new Error('Invalid live trial configuration')
  return { ...target, appOrigin: PRODUCTION_APP_ORIGIN, workerSecret, admissionEnabled }
}

/** Navigation can show existing trial status while admission is closed. */
export function isBillingLiveTrialAvailable(): boolean {
  try { return readBillingLiveTrialConfig() !== null } catch { return false }
}

function createLiveTargetReadOnlyFetch(config: BillingLiveTargetConfig, fetchImpl?: typeof fetch): typeof fetch {
  const fetchBound = createTargetBoundFetch(config.supabaseOrigin, fetchImpl)
  return async (input, init) => {
    const request = input instanceof Request ? input : undefined
    const url = new URL(request?.url ?? input.toString())
    const method = init?.method ?? request?.method ?? 'GET'
    if (
      method !== 'GET' || init?.body != null || request?.body != null
      || url.pathname !== '/rest/v1/rpc/billing_attest_live_target_v1'
      || url.username || url.password || url.hash
      || url.searchParams.size !== 2
      || url.searchParams.get('p_project_ref') !== config.projectRef
      || url.searchParams.get('p_stripe_account') !== config.stripeAccount
    ) {
      throw new Error('Live billing target transport rejected request')
    }
    return fetchBound(input, { ...init, signal: AbortSignal.timeout(5_000) })
  }
}

/** Read one boolean. Invalid targets and unexpected database responses fail closed. */
export async function checkBillingLiveTarget(input: {
  environment: NodeJS.ProcessEnv
  read: (args: LiveTargetRpcArgs, fetch: typeof globalThis.fetch) => PromiseLike<unknown>
  fetchImpl?: typeof fetch
}): Promise<BillingLiveTargetStatus> {
  if (input.environment.BILLING_LIVE_TARGET_CHECK_ENABLED !== 'true') return 'disabled'
  let config: BillingLiveTargetConfig
  try {
    config = readExactLiveBillingTarget(input.environment)
  } catch {
    return 'invalid_target'
  }
  try {
    const attested = await input.read({
      p_project_ref: config.projectRef,
      p_stripe_account: config.stripeAccount,
    }, createLiveTargetReadOnlyFetch(config, input.fetchImpl))
    return attested === true ? 'attested' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}
