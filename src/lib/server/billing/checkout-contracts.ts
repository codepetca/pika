import { z } from 'zod'

const uuid = z.string().uuid().transform(value => value.toLowerCase())
const time = z.string().datetime({ offset: true })
export const CheckoutOfferingSchema = z.object({
  offering_version_id: uuid,
  plan_key: z.enum(['basic', 'plus', 'pro']),
  stripe_account: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  stripe_product_id: z.string().regex(/^prod_[A-Za-z0-9]+$/),
  stripe_price_id: z.string().regex(/^price_[A-Za-z0-9]+$/),
  currency: z.enum(['usd', 'cad']),
  interval: z.enum(['month', 'year']),
  unit_amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  classroom_limit: z.number().int().nonnegative(),
  catalog_key: z.string().min(1).max(200),
}).strict()
export type CheckoutOffering = z.infer<typeof CheckoutOfferingSchema>

export const CheckoutUrlSchema = z.string().url().refine(value => {
  const url = new URL(value)
  return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com'
    && !url.username && !url.password && !url.port
}, 'Untrusted checkout URL')

export const CheckoutAttemptSchema = z.object({
  attempt_id: uuid,
  subject_user_id: uuid,
  offering: CheckoutOfferingSchema,
  lookup_key: z.string().min(1).max(200),
  status: z.enum(['reserved', 'open', 'payment_pending', 'bound', 'expired', 'attention']),
  customer_id: z.string().regex(/^cus_[A-Za-z0-9]+$/).nullable(),
  session_id: z.string().regex(/^cs_test_[A-Za-z0-9]+$/).nullable(),
  checkout_url: CheckoutUrlSchema.nullable(),
  success_url: z.string().url(),
  cancel_url: z.string().url(),
  write_deadline: time,
  created_at: time,
  access_confirmed: z.boolean(),
}).strict()
export type CheckoutAttempt = z.infer<typeof CheckoutAttemptSchema>

export const CheckoutClaimSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('claimed'), attempt: CheckoutAttemptSchema,
    lease_token: uuid, fencing_token: z.number().int().positive(), lease_expires_at: time }).strict(),
  z.object({ status: z.enum(['busy', 'not_found', 'terminal']) }).strict(),
])
export type CheckoutClaim = Extract<z.infer<typeof CheckoutClaimSchema>, { status: 'claimed' }>
export type CheckoutFence = { attempt_id: string; lease_token: string; fencing_token: number }
export type CheckoutReserveRequest = {
  attempt_id: string; subject_user_id: string; offering: CheckoutOffering; lookup_key: string
  success_url: string; cancel_url: string
}

/** Raw JSON transport; each consumer must decode the database result. */
export type CheckoutStore = {
  getCheckoutOffering(input: { offering_version_id: string; stripe_account: string }): Promise<unknown>
  reserveCheckout(input: CheckoutReserveRequest): Promise<unknown>
  getCheckout(input: { subject_user_id: string; attempt_id: string }): Promise<unknown>
  listCheckoutWork(input: { limit: number }): Promise<unknown>
  claimCheckout(input: { attempt_id: string; lease_seconds: number }): Promise<unknown>
  saveCheckoutProgress(input: CheckoutFence & {
    customer_id?: string; session_id?: string; checkout_url?: string | null
  }): Promise<unknown>
  finishCheckout(input: CheckoutFence & {
    outcome: 'pending' | 'bound' | 'expired' | 'retry' | 'attention'
    subscription_id?: string; payment_pending?: boolean; reason_code?: string
  }): Promise<unknown>
}

export type CheckoutSession = {
  id: string; customerId: string; subscriptionId: string | null
  status: 'open' | 'complete' | 'expired'; paymentStatus: 'paid' | 'unpaid'
  url: string | null
}
export type CheckoutProvider = {
  assertAccount(stripeAccount: string): Promise<void>
  createCustomer(idempotencyKey: string): Promise<string>
  createSession(attempt: CheckoutAttempt, customerId: string, idempotencyKey: string): Promise<CheckoutSession>
  retrieveSession(attempt: CheckoutAttempt): Promise<CheckoutSession>
}

export class CheckoutProviderContractError extends Error {
  constructor() { super('Checkout provider contract is invalid') }
}

export type PublicCheckout = {
  attemptId: string
  status: 'pending' | 'checkout_open' | 'payment_pending' | 'synchronizing' | 'active' | 'expired' | 'attention'
  checkoutUrl: string | null
}
export function publicCheckout(attempt: CheckoutAttempt): PublicCheckout {
  const statuses = { reserved: 'pending', open: 'checkout_open', payment_pending: 'payment_pending',
    bound: 'synchronizing', expired: 'expired', attention: 'attention' } as const
  return { attemptId: attempt.attempt_id, status: attempt.status === 'bound' && attempt.access_confirmed ? 'active' : statuses[attempt.status],
    checkoutUrl: attempt.status === 'open' ? attempt.checkout_url : null }
}
