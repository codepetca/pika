import { createTargetBoundFetch, verifyHostedSupabaseApiOrigin } from '@/lib/server/supabase-target'

// These identify Pika's production target independently of caller-supplied URLs.
const PRODUCTION_APP_ORIGIN = 'https://pika.codepet.ca'
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

/** This config is for the read-only operator check. Billing routes use sandbox configuration. */
function readBillingLiveTargetConfig(env: NodeJS.ProcessEnv): BillingLiveTargetConfig | null {
  if (env.BILLING_LIVE_TARGET_CHECK_ENABLED !== 'true') return null
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
  const supabaseOrigin = verifyHostedSupabaseApiOrigin(env.NEXT_PUBLIC_SUPABASE_URL, PRODUCTION_PROJECT_REF)
  if (env.NEXT_PUBLIC_SUPABASE_URL !== supabaseOrigin && env.NEXT_PUBLIC_SUPABASE_URL !== supabaseOrigin + '/') {
    throw new Error('Invalid live billing target')
  }
  return { projectRef: PRODUCTION_PROJECT_REF, stripeAccount, supabaseOrigin }
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
  let config: BillingLiveTargetConfig | null
  try {
    config = readBillingLiveTargetConfig(input.environment)
  } catch {
    return 'invalid_target'
  }
  if (!config) return 'disabled'
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
