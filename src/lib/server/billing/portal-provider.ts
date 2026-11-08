import { z } from 'zod'

const configurationSchema = z.object({
  id: z.string(), object: z.literal('billing_portal.configuration'), active: z.literal(true), livemode: z.literal(false),
  features: z.object({
    invoice_history: z.object({ enabled: z.literal(true) }),
    payment_method_update: z.object({ enabled: z.literal(true) }),
    subscription_cancel: z.object({ enabled: z.literal(false) }),
    subscription_update: z.object({ enabled: z.literal(false) }),
  }),
})
const customerSchema = z.object({
  subject_user_id: z.string().uuid(), stripe_account: z.string(), provider_mode: z.literal('test'),
  stripe_customer_id: z.string().regex(/^cus_[A-Za-z0-9]+$/),
})
const sessionSchema = z.object({
  object: z.literal('billing_portal.session'), configuration: z.string(), customer: z.string(),
  livemode: z.literal(false), return_url: z.string(), url: z.string().url(),
})

export type PortalPort = {
  getCustomer(userId: string, account: string): Promise<unknown>
  getAccount(): Promise<unknown>
  getConfiguration(id: string): Promise<unknown>
  createSession(input: { customer: string; configuration: string; return_url: string }): Promise<unknown>
}

/** Reject untrusted DB and provider evidence before returning any bearer URL. */
export async function createPortalSession(port: PortalPort, input: {
  userId: string; account: string; configurationId: string; returnUrl: string
}): Promise<string> {
  const binding = customerSchema.parse(await port.getCustomer(input.userId, input.account))
  if (binding.subject_user_id !== input.userId || binding.stripe_account !== input.account) throw new Error('Portal binding mismatch')
  const account = z.object({ id: z.string() }).parse(await port.getAccount())
  if (account.id !== input.account) throw new Error('Portal account mismatch')
  const config = configurationSchema.parse(await port.getConfiguration(input.configurationId))
  if (config.id !== input.configurationId) throw new Error('Portal configuration mismatch')
  const session = sessionSchema.parse(await port.createSession({
    customer: binding.stripe_customer_id, configuration: config.id, return_url: input.returnUrl,
  }))
  if (session.customer !== binding.stripe_customer_id || session.configuration !== config.id || session.return_url !== input.returnUrl) {
    throw new Error('Portal session mismatch')
  }
  const url = new URL(session.url)
  if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com' || url.port || url.username || url.password) {
    throw new Error('Portal destination mismatch')
  }
  return session.url
}
