import { readBillingSandboxConfig, type BillingSandboxConfig } from '@/lib/server/billing/config'

export type BillingPurchaseConfig = BillingSandboxConfig & { appOrigin: string }

/** Redirect and CSRF origin comes from trusted configuration, never Host headers. */
export function readBillingPurchaseConfig(env: NodeJS.ProcessEnv = process.env): BillingPurchaseConfig | null {
  if (env.BILLING_CHECKOUT_ENABLED !== 'true') return null
  const config = readBillingSandboxConfig(env)
  if (!config) return null
  let url: URL
  try { url = new URL(env.BILLING_APP_ORIGIN ?? '') } catch {
    throw new Error('Billing purchase configuration is invalid')
  }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Billing purchase configuration is invalid')
  }
  return { ...config, appOrigin: url.origin }
}
