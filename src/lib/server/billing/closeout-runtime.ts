import Stripe from 'stripe'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import type { BillingSandboxConfig } from './config'
import { createBillingCloseoutStore } from './closeout-store'
import { closeDueRenewals } from './closeout-service'
import { createStripeCloseoutProvider, type StripeCloseoutPort } from './stripe-closeout-provider'
import { createStripeBillingReadPort, STRIPE_BILLING_API_VERSION } from './runtime'

export function createStripeCloseoutPort(stripe: Stripe): StripeCloseoutPort {
  const read = createStripeBillingReadPort(stripe)
  return {
    ...read,
    subscriptions: { ...read.subscriptions, cancel: (id, input) => stripe.subscriptions.cancel(id, input) },
    invoices: { ...read.invoices,
      list: input => stripe.invoices.list(input),
      update: (id, input, options) => stripe.invoices.update(id, input, options),
      voidInvoice: (id, input, options) => stripe.invoices.voidInvoice(id, input, options),
    },
  }
}
/** Constructed only by the authorized, enabled loopback sandbox worker. */
export function createBillingCloseoutRuntime(config: BillingSandboxConfig) {
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_BILLING_API_VERSION, timeout: 5_000, maxNetworkRetries: 0 })
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const store = createBillingCloseoutStore(client)
  const provider = createStripeCloseoutProvider(createStripeCloseoutPort(stripe))
  return { closeDueRenewals: (input: { limit: number }) => closeDueRenewals({ store, provider, ...input, leaseSeconds: 120 }) }
}
