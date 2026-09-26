import Stripe from 'stripe'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { STRIPE_BILLING_API_VERSION } from '@/lib/server/billing/runtime'
import type { BillingPurchaseConfig } from '@/lib/server/billing/purchase-config'
import { createBillingPurchaseStore } from '@/lib/server/billing/purchase-store'
import { createCheckoutService } from '@/lib/server/billing/checkout-service'
import { createStripeCheckoutPort, createStripeCheckoutProvider } from '@/lib/server/billing/stripe-checkout-provider'
import { listLaunchPurchaseCatalog, validateLaunchCheckoutOffering } from '@/lib/server/billing/purchase-catalog'
import type { BillingPurchaseRuntime } from '@/lib/server/billing/purchase-handlers'

/** Called only after configuration and request authorization pass. */
export function createBillingPurchaseRuntime(config: BillingPurchaseConfig): BillingPurchaseRuntime & {
  reconcileCheckouts(input: { limit: number }): Promise<{ processed: number; failed: number }>
} {
  const stripe = new Stripe(config.secretKey, {
    apiVersion: STRIPE_BILLING_API_VERSION, timeout: 5_000, maxNetworkRetries: 0,
  })
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const store = createBillingPurchaseStore(client)
  const service = createCheckoutService({
    store, provider: createStripeCheckoutProvider(createStripeCheckoutPort(stripe)),
    stripeAccount: config.stripeAccount, returnOrigin: config.appOrigin,
    validateOffering: validateLaunchCheckoutOffering,
  })
  return {
    ...service,
    listCatalog: () => listLaunchPurchaseCatalog({
      stripeAccount: config.stripeAccount,
      listOfferings: () => store.listOfferings({ stripe_account: config.stripeAccount }),
    }),
  }
}
