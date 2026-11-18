import Stripe from 'stripe'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import { STRIPE_BILLING_API_VERSION } from './runtime'
import type { BillingPurchaseConfig } from './purchase-config'
import type { BillingLivePaymentWorkerConfig } from './live-target'
import { createPortalSession } from './portal-provider'

export function createBillingPortalRuntime(config: BillingPurchaseConfig | BillingLivePaymentWorkerConfig, configurationId: string) {
  const live = 'providerMode' in config && config.providerMode === 'live'
  const stripe = new Stripe(config.secretKey, { apiVersion: STRIPE_BILLING_API_VERSION, timeout: 5_000, maxNetworkRetries: 0 })
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  return {
    async open(userId: string) {
      if (live && 'projectRef' in config) {
        const ready = await client.rpc('billing_live_payment_lifecycle_ready_v1', {
          p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount,
        }).abortSignal(AbortSignal.timeout(5_000))
        if (ready.error || ready.data !== true) throw new Error('Portal unavailable')
      }
      return createPortalSession({
        async getCustomer(subject, account) {
          const { data, error } = await client.from('stripe_billing_customers')
            .select('subject_user_id,stripe_account,provider_mode,stripe_customer_id')
            .eq('subject_user_id', subject).eq('stripe_account', account).eq('provider_mode', live ? 'live' : 'test').abortSignal(AbortSignal.timeout(5_000)).maybeSingle()
          if (error) throw new Error('Portal customer lookup failed')
          return data
        },
        getAccount: () => stripe.accounts.retrieve(null),
        getStripeCustomer: id => stripe.customers.retrieve(id),
        getConfiguration: id => stripe.billingPortal.configurations.retrieve(id),
        createSession: input => stripe.billingPortal.sessions.create(input),
      }, { userId, account: config.stripeAccount, configurationId, returnUrl: `${config.appOrigin}/billing`, providerMode: live ? 'live' : 'test' })
    },
  }
}
