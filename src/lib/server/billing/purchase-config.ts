import { LAUNCH_CATALOG_RELEASE_TAG, REPOLIGHT_CATALOG_RELEASE_TAG } from '@/lib/billing/launch-catalog'
import { readBillingSandboxConfig, type BillingSandboxConfig } from '@/lib/server/billing/config'

export type BillingPurchaseConfig = BillingSandboxConfig & { appOrigin: string; catalogRelease: typeof LAUNCH_CATALOG_RELEASE_TAG | typeof REPOLIGHT_CATALOG_RELEASE_TAG }

/** Redirect and CSRF origin comes from trusted configuration, never Host headers. */
export function readBillingPurchaseConfig(env: NodeJS.ProcessEnv = process.env): BillingPurchaseConfig | null {
  if (env.BILLING_CHECKOUT_ENABLED !== 'true') return null
  const config = readBillingSandboxConfig(env)
  if (!config) return null
  const release = env.BILLING_REPOLIGHT_CATALOG_ENABLED ?? 'false'
  if (!['true', 'false'].includes(release)) throw new Error('Billing purchase configuration is invalid')
  let url: URL
  try { url = new URL(env.BILLING_APP_ORIGIN ?? '') } catch {
    throw new Error('Billing purchase configuration is invalid')
  }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Billing purchase configuration is invalid')
  }
  return { ...config, appOrigin: url.origin, catalogRelease: release === 'true' ? REPOLIGHT_CATALOG_RELEASE_TAG : LAUNCH_CATALOG_RELEASE_TAG }
}
