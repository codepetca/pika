import Stripe from 'stripe'
import { getServiceRoleClient } from '@/lib/supabase'
import type { BillingSandboxConfig } from '@/lib/server/billing/config'
import type { BillingHandlerRuntime } from '@/lib/server/billing/handlers'
import { createBillingStore } from '@/lib/server/billing/store'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import {
  createStripeBillingProvider,
  type StripeBillingReadPort,
} from '@/lib/server/billing/stripe-provider'

/** Pinned to the API version whose response shapes this foundation validates. */
export const STRIPE_BILLING_API_VERSION = '2026-08-26.dahlia' as const
const STRIPE_REQUEST_TIMEOUT_MS = 5_000

/**
 * The SDK has different call signatures from the narrow read seam. Keep
 * required expansions here, close to the pinned API version.
 */
export function createStripeBillingReadPort(stripe: Stripe): StripeBillingReadPort {
  return {
    // `null` is Stripe's documented current-account selector.
    accounts: { retrieve: () => stripe.accounts.retrieve(null) },
    subscriptions: { retrieve: id => stripe.subscriptions.retrieve(id) },
    // Invoice.payments is optional unless explicitly expanded in SDK 22.6.2.
    invoices: { retrieve: id => stripe.invoices.retrieve(id, { expand: ['payments'] }) },
    paymentIntents: { retrieve: id => stripe.paymentIntents.retrieve(id) },
    charges: { retrieve: id => stripe.charges.retrieve(id) },
  }
}

/** Constructs SDK and database clients only after the local sandbox gate passes. */
export function createBillingRuntime(config: BillingSandboxConfig): BillingHandlerRuntime {
  const stripe = new Stripe(config.secretKey, {
    apiVersion: STRIPE_BILLING_API_VERSION,
    timeout: STRIPE_REQUEST_TIMEOUT_MS,
    maxNetworkRetries: 0,
  })
  const client = getServiceRoleClient({
    // The shared guard pins this client to loopback and rejects redirect responses.
    fetch: createTargetBoundFetch(config.supabaseOrigin),
  })
  const store = createBillingStore(client)

  return {
    store,
    provider: createStripeBillingProvider(createStripeBillingReadPort(stripe)),
    verify(raw, signature) {
      return stripe.webhooks.constructEvent(raw, signature, config.webhookSecret)
    },
    record: store.recordEvent,
  }
}
