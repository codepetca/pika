import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { createBillingStripeClient } from '@/lib/server/billing/runtime'
import { REPOLIGHT_CATALOG_RELEASE_TAG } from '@/lib/billing/launch-catalog'
import type { BillingPurchaseConfig } from '@/lib/server/billing/purchase-config'
import type { BillingLiveCheckoutConfig } from '@/lib/server/billing/live-target'
import { createBillingPurchaseStore, createLiveBillingPurchaseStore } from '@/lib/server/billing/purchase-store'
import { createCheckoutService } from '@/lib/server/billing/checkout-service'
import { createStripeCheckoutPort, createStripeCheckoutProvider } from '@/lib/server/billing/stripe-checkout-provider'
import { listLaunchPurchaseCatalog, validateLaunchCheckoutOffering } from '@/lib/server/billing/purchase-catalog'
import { verifyPortalConfiguration } from '@/lib/server/billing/portal-provider'
import type { BillingPurchaseRuntime } from '@/lib/server/billing/purchase-handlers'

/** Called only after configuration and request authorization pass. */
export function createBillingPurchaseRuntime(config: BillingPurchaseConfig | BillingLiveCheckoutConfig): BillingPurchaseRuntime & {
  reconcileCheckouts(input: { limit: number }): Promise<{ processed: number; failed: number }>
} {
  const stripe = createBillingStripeClient(config.secretKey)
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const port = createStripeCheckoutPort(stripe)
  if ('providerMode' in config) {
    const liveConfig = config
    const store = createLiveBillingPurchaseStore({
      rpc: (name, args) => client.rpc(name, args).abortSignal(AbortSignal.timeout(5_000)),
    }, config)
    async function authorizeNewCheckout(): Promise<boolean> {
      if (!liveConfig.checkoutAdmissionEnabled || !liveConfig.providerWritesEnabled || !liveConfig.portalConfigurationId) return false
      try {
        const { data, error } = await client.rpc('billing_live_checkout_activation_ready_v1', {
          p_project_ref: liveConfig.projectRef, p_stripe_account: liveConfig.stripeAccount,
        }).abortSignal(AbortSignal.timeout(5_000))
        if (error || data !== true) return false
        await verifyPortalConfiguration({ getAccount: () => stripe.accounts.retrieve(null),
          getConfiguration: id => stripe.billingPortal.configurations.retrieve(id) },
        { account: liveConfig.stripeAccount, configurationId: liveConfig.portalConfigurationId, providerMode: 'live' })
        return true
      } catch { return false }
    }
    return {
      ...createCheckoutService({
        store,
        provider: createStripeCheckoutProvider(port, config),
        stripeAccount: config.stripeAccount, returnOrigin: config.appOrigin,
        providerMode: config.providerMode,
        checkoutAdmissionEnabled: config.checkoutAdmissionEnabled,
        providerWritesEnabled: config.providerWritesEnabled,
        authorizeProviderWrite: store.authorizeProviderWrite,
        authorizeNewCheckout,
        validateOffering: offering => validateLaunchCheckoutOffering(offering, REPOLIGHT_CATALOG_RELEASE_TAG),
      }),
      async listCatalog() {
        if (!await authorizeNewCheckout()) return []
        return listLaunchPurchaseCatalog({
          stripeAccount: config.stripeAccount, providerMode: config.providerMode, release: REPOLIGHT_CATALOG_RELEASE_TAG,
          listOfferings: () => store.listOfferings({ stripe_account: config.stripeAccount }),
        })
      },
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
