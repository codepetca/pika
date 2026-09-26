import { z } from 'zod'

const billingSandboxEnvironmentSchema = z.object({
  STRIPE_SECRET_KEY: z.string().regex(/^sk_test_[A-Za-z0-9_]+$/),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9_]+$/),
  STRIPE_ACCOUNT_ID: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  BILLING_WORKER_SECRET: z.string().min(32),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
})

export type BillingSandboxConfig = {
  secretKey: string
  webhookSecret: string
  stripeAccount: string
  workerSecret: string
  supabaseOrigin: string
}

/** No hosted mode exists in this foundation. Enabling it requires a later rollout. */
export function readBillingSandboxConfig(
  env: NodeJS.ProcessEnv = process.env,
): BillingSandboxConfig | null {
  if (env.BILLING_SANDBOX_ENABLED !== 'true') return null
  const parsed = billingSandboxEnvironmentSchema.safeParse(env)
  if (!parsed.success || env.VERCEL === '1' || env.VERCEL_ENV === 'production') {
    throw new Error('Billing sandbox configuration is invalid')
  }
  const url = new URL(parsed.data.NEXT_PUBLIC_SUPABASE_URL)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.port !== '54321' || url.username || url.password ||
    url.pathname !== '/' || url.search || url.hash
  ) throw new Error('Billing sandbox configuration is invalid')
  return {
    secretKey: parsed.data.STRIPE_SECRET_KEY,
    webhookSecret: parsed.data.STRIPE_WEBHOOK_SECRET,
    stripeAccount: parsed.data.STRIPE_ACCOUNT_ID,
    workerSecret: parsed.data.BILLING_WORKER_SECRET,
    supabaseOrigin: url.origin,
  }
}
