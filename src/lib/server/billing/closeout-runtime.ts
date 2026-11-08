import type Stripe from 'stripe'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import type { BillingSandboxConfig } from './config'
import type { BillingLiveCheckoutConfig } from './live-target'
import { createBillingCloseoutStore, createLiveBillingCloseoutStore } from './closeout-store'
import { closeDueRenewals } from './closeout-service'
import { createStripeCloseoutProvider, type StripeCloseoutPort } from './stripe-closeout-provider'
import { createBillingStripeClient, createStripeBillingReadPort } from './runtime'

export function createStripeCloseoutPort(stripe: Stripe): StripeCloseoutPort {
  const read = createStripeBillingReadPort(stripe)
  return {
    ...read,
    retrieveSchedule: id => stripe.subscriptionSchedules.retrieve(id),
    cancelSchedule: (id, input, options) => stripe.subscriptionSchedules.cancel(id, input, options),
    subscriptions: { ...read.subscriptions, cancel: (id, input) => stripe.subscriptions.cancel(id, input) },
    invoices: { ...read.invoices,
      list: input => stripe.invoices.list(input),
      listCustomer: input => stripe.invoices.list(input),
      update: (id, input, options) => stripe.invoices.update(id, input, options),
      voidInvoice: (id, input, options) => stripe.invoices.voidInvoice(id, input, options),
    },
  }
}
/** Constructed only by the authorized, enabled loopback sandbox worker. */
export function createBillingCloseoutRuntime(config: BillingSandboxConfig) {
  const stripe = createBillingStripeClient(config.secretKey)
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const store = createBillingCloseoutStore(client, process.env.BILLING_SCHEDULED_RENEWALS_ENABLED === 'true')
  const provider = createStripeCloseoutProvider(createStripeCloseoutPort(stripe))
  return { closeDueRenewals: (input: { limit: number }) => closeDueRenewals({ store, provider, ...input, leaseSeconds: 120 }) }
}

export function closeDueLiveRenewals(config: BillingLiveCheckoutConfig) {
  const stripe = createBillingStripeClient(config.secretKey)
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const store = createLiveBillingCloseoutStore({
    rpc: (name, args) => client.rpc(name, args).abortSignal(AbortSignal.timeout(5_000)),
  }, config)
  const scope = { providerMode: config.providerMode, stripeAccount: config.stripeAccount }
  const provider = createStripeCloseoutProvider(createStripeCloseoutPort(stripe), scope)
  return closeDueRenewals({ store, provider, scope, limit: 1, leaseSeconds: 120 })
}
