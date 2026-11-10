import { z } from 'zod'
import { PRODUCTION_APP_ORIGIN } from './live-target'

const configurationSchema = z.object({
  id: z.string(), object: z.literal('billing_portal.configuration'), active: z.literal(true), livemode: z.boolean(),
  features: z.object({
    customer_update: z.object({ enabled: z.boolean(), allowed_updates: z.array(z.string()).max(10).optional() }).optional(),
    invoice_history: z.object({ enabled: z.literal(true) }),
    payment_method_update: z.object({ enabled: z.literal(true) }),
    subscription_cancel: z.object({ enabled: z.boolean(), mode: z.string().optional(), proration_behavior: z.string().optional(),
      retention: z.null().optional(), coupon: z.null().optional(), coupon_offer: z.null().optional() }),
    subscription_update: z.object({ enabled: z.literal(false) }),
  }),
})
const customerSchema = z.object({
  subject_user_id: z.string().uuid(), stripe_account: z.string(), provider_mode: z.enum(['test', 'live']),
  stripe_customer_id: z.string().regex(/^cus_[A-Za-z0-9]+$/),
})
const sessionSchema = z.object({
  object: z.literal('billing_portal.session'), configuration: z.string(), customer: z.string(),
  livemode: z.boolean(), return_url: z.string(), url: z.string().url(), flow: z.null().optional(),
})

export type PortalPort = {
  getCustomer(userId: string, account: string): Promise<unknown>
  getAccount(): Promise<unknown>
  getStripeCustomer?(customerId: string): Promise<unknown>
  getConfiguration(id: string): Promise<unknown>
  createSession(input: { customer: string; configuration: string; return_url: string }): Promise<unknown>
}

/** Verify the exact configured account and portal policy before advertising sales. */
export async function verifyPortalConfiguration(port: Pick<PortalPort, 'getAccount' | 'getConfiguration'>, input: {
  account: string; configurationId: string; providerMode: 'test' | 'live'; requireBillingAddressUpdates?: boolean
}): Promise<void> {
  if (!/^acct_[A-Za-z0-9]+$/.test(input.account) || !/^bpc_[A-Za-z0-9]+$/.test(input.configurationId)) {
    throw new Error('Portal configuration mismatch')
  }
  const account = z.object({ id: z.string() }).parse(await port.getAccount())
  if (account.id !== input.account) throw new Error('Portal account mismatch')
  const config = configurationSchema.parse(await port.getConfiguration(input.configurationId))
  const live = input.providerMode === 'live'
  const updates = config.features.customer_update
  const addressOnly = updates?.enabled === true && updates.allowed_updates?.length === 1 && updates.allowed_updates[0] === 'address'
  if (config.id !== input.configurationId || config.livemode !== live
    || (live && (input.requireBillingAddressUpdates ? !addressOnly : !addressOnly && updates?.enabled !== false))
    || (live ? !config.features.subscription_cancel.enabled || config.features.subscription_cancel.mode !== 'at_period_end'
      || config.features.subscription_cancel.proration_behavior !== 'none' : config.features.subscription_cancel.enabled)) {
    throw new Error('Portal configuration mismatch')
  }
}

/** Reject untrusted DB and provider evidence before returning any bearer URL. */
export async function createPortalSession(port: PortalPort, input: {
  userId: string; account: string; configurationId: string; returnUrl: string; providerMode?: 'test' | 'live'
}): Promise<string> {
  const mode = input.providerMode ?? 'test'
  if (mode !== 'test' && mode !== 'live') throw new Error('Portal mode mismatch')
  const live = mode === 'live'
  if (live && input.returnUrl !== `${PRODUCTION_APP_ORIGIN}/billing`) throw new Error('Portal return URL mismatch')
  const binding = customerSchema.parse(await port.getCustomer(input.userId, input.account))
  if (binding.subject_user_id !== input.userId || binding.stripe_account !== input.account || binding.provider_mode !== mode) throw new Error('Portal binding mismatch')
  await verifyPortalConfiguration(port, { account: input.account, configurationId: input.configurationId, providerMode: mode })
  if (live) {
    if (!port.getStripeCustomer) throw new Error('Portal customer unavailable')
    const customer = z.object({ id: z.string(), livemode: z.literal(true), deleted: z.literal(false).optional() })
      .parse(await port.getStripeCustomer(binding.stripe_customer_id))
    if (customer.id !== binding.stripe_customer_id) throw new Error('Portal customer mismatch')
  }
  const session = sessionSchema.parse(await port.createSession({
    customer: binding.stripe_customer_id, configuration: input.configurationId, return_url: input.returnUrl,
  }))
  if ((live && session.flow !== null) || session.livemode !== live || session.customer !== binding.stripe_customer_id || session.configuration !== input.configurationId || session.return_url !== input.returnUrl) {
    throw new Error('Portal session mismatch')
  }
  const url = new URL(session.url)
  if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.port || url.username || url.password) {
    throw new Error('Portal destination mismatch')
  }
  return session.url
}
