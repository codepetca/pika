import { readBillingPurchaseConfig } from './purchase-config'

/** A separately selected portal configuration is required; Stripe defaults are never used. */
export function readBillingPortalConfig(env: NodeJS.ProcessEnv = process.env) {
  const id = env.BILLING_PORTAL_CONFIGURATION_ID
  if (!id) return null
  if (!/^bpc_[A-Za-z0-9]+$/.test(id)) throw new Error('Invalid portal configuration')
  const purchase = readBillingPurchaseConfig(env)
  return purchase ? { ...purchase, portalConfigurationId: id } : null
}
