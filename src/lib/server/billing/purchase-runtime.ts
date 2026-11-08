import Stripe from 'stripe'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { STRIPE_BILLING_API_VERSION } from '@/lib/server/billing/runtime'
import { REPOLIGHT_CATALOG_RELEASE_TAG } from '@/lib/billing/launch-catalog'
import type { BillingPurchaseConfig } from '@/lib/server/billing/purchase-config'
import type { BillingLiveCheckoutConfig } from '@/lib/server/billing/live-target'
import { createBillingPurchaseStore, createLiveBillingPurchaseStore } from '@/lib/server/billing/purchase-store'
import { createCheckoutService } from '@/lib/server/billing/checkout-service'
import { createStripeCheckoutPort, createStripeCheckoutProvider } from '@/lib/server/billing/stripe-checkout-provider'
import { listLaunchPurchaseCatalog, validateLaunchCheckoutOffering } from '@/lib/server/billing/purchase-catalog'
import type { BillingPurchaseRuntime } from '@/lib/server/billing/purchase-handlers'

/** Called only after configuration and request authorization pass. */
export function createBillingPurchaseRuntime(config: BillingPurchaseConfig | BillingLiveCheckoutConfig): BillingPurchaseRuntime & {
  reconcileCheckouts(input: { limit: number }): Promise<{ processed: number; failed: number }>
} {
  const stripe = new Stripe(config.secretKey, {
    apiVersion: STRIPE_BILLING_API_VERSION, timeout: 5_000, maxNetworkRetries: 0,
  })
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const port = createStripeCheckoutPort(stripe)
  if ('providerMode' in config) {
    const store = createLiveBillingPurchaseStore({
      rpc: (name, args) => client.rpc(name, args).abortSignal(AbortSignal.timeout(5_000)),
    }, config)
    return {
      ...createCheckoutService({
        store,
        provider: createStripeCheckoutProvider(port, config),
        stripeAccount: config.stripeAccount, returnOrigin: config.appOrigin,
        providerMode: config.providerMode,
        checkoutAdmissionEnabled: config.checkoutAdmissionEnabled,
        providerWritesEnabled: config.providerWritesEnabled,
        authorizeProviderWrite: store.authorizeProviderWrite,
        validateOffering: offering => validateLaunchCheckoutOffering(offering, REPOLIGHT_CATALOG_RELEASE_TAG),
      }),
      listCatalog: () => listLaunchPurchaseCatalog({
        stripeAccount: config.stripeAccount, providerMode: config.providerMode, release: REPOLIGHT_CATALOG_RELEASE_TAG,
        listOfferings: () => store.listOfferings({ stripe_account: config.stripeAccount }),
      }),
    }
  }
  const store = createBillingPurchaseStore(client)
  const service = createCheckoutService({
    store, provider: createStripeCheckoutProvider(port),
    stripeAccount: config.stripeAccount, returnOrigin: config.appOrigin,
    validateOffering: offering => validateLaunchCheckoutOffering(offering, config.catalogRelease),
  })
  return {
    ...service,
    listCatalog: () => listLaunchPurchaseCatalog({
      stripeAccount: config.stripeAccount, release: config.catalogRelease,
      listOfferings: () => store.listOfferings({ stripe_account: config.stripeAccount }),
    }),
  }
}
