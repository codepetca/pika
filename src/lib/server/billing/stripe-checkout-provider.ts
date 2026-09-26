import Stripe from 'stripe'
import { z } from 'zod'
import { CheckoutProviderContractError, CheckoutUrlSchema,
  type CheckoutAttempt, type CheckoutProvider, type CheckoutSession } from './checkout-contracts'

export type StripeCheckoutPort = {
  retrieveAccount(): Promise<unknown>
  createCustomer(idempotencyKey: string): Promise<unknown>
  createSession(attempt: CheckoutAttempt, customerId: string, idempotencyKey: string): Promise<unknown>
  retrieveSession(sessionId: string): Promise<unknown>
}

export function createStripeCheckoutPort(stripe: Stripe): StripeCheckoutPort {
  return {
    retrieveAccount: () => stripe.accounts.retrieve(null),
    createCustomer: idempotencyKey => stripe.customers.create({}, { idempotencyKey }),
    createSession: (attempt, customerId, idempotencyKey) => stripe.checkout.sessions.create({
      mode: 'subscription', ui_mode: 'hosted_page', customer: customerId,
      line_items: [{ price: attempt.offering.stripe_price_id, quantity: 1 }],
      payment_method_types: ['card'], allow_promotion_codes: false,
      automatic_tax: { enabled: false }, adaptive_pricing: { enabled: false },
      success_url: attempt.success_url, cancel_url: attempt.cancel_url,
      expand: ['line_items.data.price'],
    }, { idempotencyKey }),
    retrieveSession: sessionId => stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price'] }),
  }
}

const reference = z.union([z.string(), z.object({ id: z.string() })])
  .transform(value => typeof value === 'string' ? value : value.id)
const sessionSchema = z.object({
  id: z.string().regex(/^cs_test_[A-Za-z0-9]+$/), livemode: z.literal(false),
  mode: z.literal('subscription'), ui_mode: z.literal('hosted_page'), customer: reference, subscription: reference.nullable(),
  status: z.enum(['open', 'complete', 'expired']), payment_status: z.enum(['paid', 'unpaid']),
  url: CheckoutUrlSchema.nullable(), currency: z.enum(['usd', 'cad']),
  amount_subtotal: z.number().int().positive(), amount_total: z.number().int().positive(),
  payment_method_types: z.tuple([z.literal('card')]),
  automatic_tax: z.object({ enabled: z.literal(false) }),
  allow_promotion_codes: z.union([z.literal(false), z.null()]),
  total_details: z.object({ amount_discount: z.literal(0), amount_tax: z.literal(0), amount_shipping: z.literal(0) }),
  success_url: z.string(), cancel_url: z.string(),
  line_items: z.object({ has_more: z.literal(false), data: z.array(z.object({
    quantity: z.literal(1), amount_subtotal: z.number().int().positive(), amount_total: z.number().int().positive(),
    amount_discount: z.literal(0), amount_tax: z.literal(0), currency: z.string(),
    price: z.object({ id: z.string(), livemode: z.literal(false), product: reference,
      currency: z.string(), unit_amount: z.number().int().positive(),
      recurring: z.object({ interval: z.enum(['month', 'year']), interval_count: z.literal(1) }),
    }),
  })).length(1) }),
})

function session(value: unknown, attempt: CheckoutAttempt, customerId: string): CheckoutSession {
  const decoded = sessionSchema.safeParse(value)
  if (!decoded.success) throw new CheckoutProviderContractError()
  const item = decoded.data
  const line = item.line_items.data[0]
  const expected = attempt.offering
  if (item.customer !== customerId || item.success_url !== attempt.success_url || item.cancel_url !== attempt.cancel_url
    || item.currency !== expected.currency || line.currency !== expected.currency || line.price.currency !== expected.currency
    || item.amount_subtotal !== expected.unit_amount || item.amount_total !== expected.unit_amount
    || line.amount_subtotal !== expected.unit_amount || line.amount_total !== expected.unit_amount
    || line.price.id !== expected.stripe_price_id || line.price.product !== expected.stripe_product_id
    || line.price.unit_amount !== expected.unit_amount || line.price.recurring.interval !== expected.interval
    || (item.status === 'open' && (!item.url || item.subscription !== null || item.payment_status !== 'unpaid'))
    || (item.status === 'expired' && (item.subscription !== null || item.payment_status !== 'unpaid'))
    || (item.status === 'complete' && (!item.subscription || !/^sub_[A-Za-z0-9]+$/.test(item.subscription)))) {
    throw new CheckoutProviderContractError()
  }
  return { id: item.id, customerId: item.customer, subscriptionId: item.subscription,
    status: item.status, paymentStatus: item.payment_status, url: item.url }
}

export function createStripeCheckoutProvider(port: StripeCheckoutPort): CheckoutProvider {
  return {
    async assertAccount(stripeAccount) {
      const result = z.object({ id: z.string() }).safeParse(await port.retrieveAccount())
      if (!result.success || result.data.id !== stripeAccount) throw new CheckoutProviderContractError()
    },
    async createCustomer(idempotencyKey) {
      const result = z.object({ id: z.string().regex(/^cus_[A-Za-z0-9]+$/), livemode: z.literal(false),
        deleted: z.literal(false).optional() }).safeParse(await port.createCustomer(idempotencyKey))
      if (!result.success) throw new CheckoutProviderContractError()
      return result.data.id
    },
    async createSession(attempt, customerId, idempotencyKey) {
      return session(await port.createSession(attempt, customerId, idempotencyKey), attempt, customerId)
    },
    async retrieveSession(attempt) {
      if (!attempt.session_id || !attempt.customer_id) throw new CheckoutProviderContractError()
      const result = session(await port.retrieveSession(attempt.session_id), attempt, attempt.customer_id)
      if (result.id !== attempt.session_id) throw new CheckoutProviderContractError()
      return result
    },
  }
}
