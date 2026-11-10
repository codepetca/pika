import Stripe from 'stripe'
import { z } from 'zod'
import { stripeUnitAmountDecimalSchema } from './stripe-decimal'
import { CheckoutProviderContractError, CheckoutUrlSchema,
  CheckoutAttemptSchema, type CheckoutAttempt, type CheckoutProvider, type CheckoutSession } from './checkout-contracts'

export type StripeCheckoutPort = {
  retrieveAccount(): Promise<unknown>
  createCustomer(idempotencyKey: string): Promise<unknown>
  retrieveCustomer(customerId: string): Promise<unknown>
  retrievePrice(priceId: string): Promise<unknown>
  createSession(attempt: CheckoutAttempt, customerId: string, idempotencyKey: string): Promise<unknown>
  retrieveSession(sessionId: string): Promise<unknown>
}

export function createStripeCheckoutPort(stripe: Stripe): StripeCheckoutPort {
  return {
    retrieveAccount: () => stripe.accounts.retrieve(null),
    createCustomer: idempotencyKey => stripe.customers.create({}, { idempotencyKey }),
    retrieveCustomer: customerId => stripe.customers.retrieve(customerId),
    retrievePrice: priceId => stripe.prices.retrieve(priceId, { expand: ['product'] }),
    createSession: (attempt, customerId, idempotencyKey) => stripe.checkout.sessions.create({
      mode: 'subscription', ui_mode: 'hosted_page', customer: customerId,
      line_items: [{ price: attempt.offering.stripe_price_id, quantity: 1 }],
      payment_method_types: ['card'], allow_promotion_codes: false,
      ...(attempt.offering.tax_mode === 'stripe_exclusive'
        ? { automatic_tax: { enabled: true, liability: { type: 'self' as const } }, billing_address_collection: 'required' as const, customer_update: { address: 'auto' as const } }
        : { automatic_tax: { enabled: false } }), adaptive_pricing: { enabled: false },
      success_url: attempt.success_url, cancel_url: attempt.cancel_url,
      expand: ['line_items.data.price'],
    }, { idempotencyKey }),
    retrieveSession: sessionId => stripe.checkout.sessions.retrieve(sessionId, { expand: ['line_items.data.price'] }),
  }
}

const reference = z.union([z.string(), z.object({ id: z.string() })])
  .transform(value => typeof value === 'string' ? value : value.id)
const sessionSchema = z.object({
  id: z.string().regex(/^cs_(?:test|live)_[A-Za-z0-9]+$/), livemode: z.boolean(),
  mode: z.literal('subscription'), ui_mode: z.literal('hosted_page'), customer: reference, subscription: reference.nullable(),
  status: z.enum(['open', 'complete', 'expired']), payment_status: z.enum(['paid', 'unpaid']),
  url: CheckoutUrlSchema.nullable(), currency: z.enum(['usd', 'cad']),
  amount_subtotal: z.number().int().positive(), amount_total: z.number().int().positive(),
  payment_method_types: z.tuple([z.literal('card')]),
  automatic_tax: z.object({ enabled: z.boolean(), status: z.string().nullable().optional(), liability: z.object({ type: z.string() }).nullable().optional() }),
  allow_promotion_codes: z.union([z.literal(false), z.null()]),
  total_details: z.object({ amount_discount: z.literal(0), amount_tax: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), amount_shipping: z.literal(0) }),
  success_url: z.string(), cancel_url: z.string(),
  line_items: z.object({ has_more: z.literal(false), data: z.array(z.object({
    quantity: z.literal(1), amount_subtotal: z.number().int().positive(), amount_total: z.number().int().positive(),
    amount_discount: z.literal(0), amount_tax: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), currency: z.string(),
    price: z.object({ id: z.string(), livemode: z.boolean(), product: reference,
      currency: z.string(), unit_amount: z.number().int().positive(),
      recurring: z.object({ interval: z.enum(['month', 'year']), interval_count: z.literal(1) }),
    }),
  })).length(1) }),
})

// Live recovery rejects optional tax/discount structures we cannot reconcile.
const liveSessionEvidenceSchema = z.object({
  discounts: z.array(z.never()).nullable().optional(),
  total_details: z.object({ breakdown: z.object({ discounts: z.array(z.never()), taxes: z.array(z.never()) }).nullable().optional() }),
  line_items: z.object({ data: z.array(z.object({
    discounts: z.array(z.never()).nullable().optional(), taxes: z.array(z.never()).nullable().optional(),
    price: z.object({ billing_scheme: z.literal('per_unit'), tax_behavior: z.enum(['unspecified', 'exclusive']),
      transform_quantity: z.null(), unit_amount_decimal: stripeUnitAmountDecimalSchema,
      recurring: z.object({ usage_type: z.literal('licensed'), trial_period_days: z.null() }) }),
  })).length(1) }),
})

const taxedSessionEvidenceSchema = z.object({
  billing_address_collection: z.literal('required'),
  shipping_cost: z.null(), shipping_options: z.array(z.never()), shipping_address_collection: z.null(),
  discounts: z.array(z.never()).nullable().optional(),
  total_details: z.object({ breakdown: z.object({ discounts: z.array(z.never()) }).nullable().optional() }),
  line_items: z.object({ data: z.array(z.object({ discounts: z.array(z.never()).nullable().optional(),
    price: z.object({ billing_scheme: z.literal('per_unit'), tax_behavior: z.literal('exclusive'),
      transform_quantity: z.null(), unit_amount_decimal: stripeUnitAmountDecimalSchema,
      recurring: z.object({ usage_type: z.literal('licensed'), trial_period_days: z.null() }) }) })).length(1) }),
})

function session(value: unknown, attempt: CheckoutAttempt, customerId: string, live: boolean): CheckoutSession {
  const decoded = sessionSchema.safeParse(value)
  if (!decoded.success) throw new CheckoutProviderContractError()
  const taxed = attempt.offering.tax_mode === 'stripe_exclusive'
  if (taxed && !live) throw new CheckoutProviderContractError()
  const liveEvidence = live ? (taxed ? taxedSessionEvidenceSchema : liveSessionEvidenceSchema).safeParse(value) : undefined
  if (liveEvidence && !liveEvidence.success) throw new CheckoutProviderContractError()
  const item = decoded.data
  const line = item.line_items.data[0]
  const expected = attempt.offering
  if (item.livemode !== live || line.price.livemode !== live || !item.id.startsWith(live ? 'cs_live_' : 'cs_test_')
    || item.customer !== customerId || item.success_url !== attempt.success_url || item.cancel_url !== attempt.cancel_url
    || item.currency !== expected.currency || line.currency !== expected.currency || line.price.currency !== expected.currency
    || item.automatic_tax.enabled !== taxed
    || (taxed && (item.automatic_tax.liability?.type !== 'self' || (item.status === 'complete' && item.automatic_tax.status !== 'complete')))
    || (!taxed && (item.total_details.amount_tax !== 0 || line.amount_tax !== 0))
    || item.total_details.amount_tax !== line.amount_tax
    || !Number.isSafeInteger(expected.unit_amount + item.total_details.amount_tax)
    || item.amount_subtotal !== expected.unit_amount || item.amount_total !== expected.unit_amount + item.total_details.amount_tax
    || line.amount_subtotal !== expected.unit_amount || line.amount_total !== expected.unit_amount + line.amount_tax
    || line.price.id !== expected.stripe_price_id || line.price.product !== expected.stripe_product_id
    || line.price.unit_amount !== expected.unit_amount || line.price.recurring.interval !== expected.interval
    || (liveEvidence?.success && liveEvidence.data.line_items.data[0].price.unit_amount_decimal !== String(expected.unit_amount))
    || (item.status === 'open' && (!item.url || item.subscription !== null || item.payment_status !== 'unpaid'))
    || (item.status === 'expired' && (item.subscription !== null || item.payment_status !== 'unpaid'))
    || (item.status === 'complete' && (!item.subscription || !/^sub_[A-Za-z0-9]+$/.test(item.subscription)))) {
    throw new CheckoutProviderContractError()
  }
  return { id: item.id, customerId: item.customer, subscriptionId: item.subscription,
    status: item.status, paymentStatus: item.payment_status, url: item.url }
}

const customerSchema = z.object({ id: z.string().regex(/^cus_[A-Za-z0-9]+$/), livemode: z.boolean(),
  deleted: z.literal(false).optional() })
const livePriceSchema = z.object({
  id: z.string(), livemode: z.literal(true), active: z.literal(true), type: z.literal('recurring'),
  billing_scheme: z.literal('per_unit'), currency: z.string(), unit_amount: z.number().int().positive(), unit_amount_decimal: stripeUnitAmountDecimalSchema,
  tax_behavior: z.enum(['unspecified', 'exclusive']), transform_quantity: z.null(),
  recurring: z.object({ interval: z.enum(['month', 'year']), interval_count: z.literal(1),
    usage_type: z.literal('licensed'), trial_period_days: z.null() }),
  product: z.object({ id: z.string(), livemode: z.literal(true), active: z.literal(true), deleted: z.literal(false).optional() }),
})

export type StripeCheckoutScope = { providerMode: 'live'; stripeAccount: string }

export function createStripeCheckoutProvider(port: StripeCheckoutPort, scope?: StripeCheckoutScope): CheckoutProvider {
  const live = scope?.providerMode === 'live'
  if (scope && (scope.providerMode !== 'live' || !/^acct_[A-Za-z0-9]+$/.test(scope.stripeAccount))) throw new CheckoutProviderContractError()
  async function assertAccount(stripeAccount: string) {
    if (live && stripeAccount !== scope!.stripeAccount) throw new CheckoutProviderContractError()
    const result = z.object({ id: z.string() }).safeParse(await port.retrieveAccount())
    if (!result.success || result.data.id !== stripeAccount) throw new CheckoutProviderContractError()
  }
  async function verifyAttempt(attempt: CheckoutAttempt) {
    const parsed = CheckoutAttemptSchema.safeParse(attempt)
    if (!parsed.success || (!live && parsed.data.offering.tax_mode !== undefined) || (live ? parsed.data.offering.provider_mode !== 'live' || parsed.data.offering.stripe_account !== scope!.stripeAccount
      : parsed.data.offering.provider_mode === 'live')) throw new CheckoutProviderContractError()
    if (live) await assertAccount(scope!.stripeAccount)
  }
  async function verifyCustomer(customerId: string) {
    const result = customerSchema.safeParse(await port.retrieveCustomer(customerId))
    if (!result.success || result.data.id !== customerId || !result.data.livemode) throw new CheckoutProviderContractError()
  }
  return {
    assertAccount,
    async createCustomer(idempotencyKey, assertCanWrite) {
      if (scope) {
        if (!assertCanWrite) throw new CheckoutProviderContractError()
        await assertAccount(scope.stripeAccount)
        await assertCanWrite()
      }
      const result = customerSchema.safeParse(await port.createCustomer(idempotencyKey))
      if (!result.success || result.data.livemode !== live) throw new CheckoutProviderContractError()
      return result.data.id
    },
    async createSession(attempt, customerId, idempotencyKey, assertCanWrite) {
      await verifyAttempt(attempt)
      if (live) {
        if (!assertCanWrite || attempt.customer_id !== customerId) throw new CheckoutProviderContractError()
        await verifyCustomer(customerId)
        const price = livePriceSchema.safeParse(await port.retrievePrice(attempt.offering.stripe_price_id))
        const expected = attempt.offering
        if (!price.success || price.data.id !== expected.stripe_price_id || price.data.product.id !== expected.stripe_product_id
          || price.data.currency !== expected.currency || price.data.unit_amount !== expected.unit_amount
          || price.data.unit_amount_decimal !== String(expected.unit_amount)
          || price.data.recurring.interval !== expected.interval
          || (expected.tax_mode === 'stripe_exclusive' && price.data.tax_behavior !== 'exclusive')) throw new CheckoutProviderContractError()
        await assertCanWrite()
      }
      return session(await port.createSession(attempt, customerId, idempotencyKey), attempt, customerId, live)
    },
    async retrieveSession(attempt) {
      await verifyAttempt(attempt)
      if (!attempt.session_id || !attempt.customer_id) throw new CheckoutProviderContractError()
      if (live) await verifyCustomer(attempt.customer_id)
      const result = session(await port.retrieveSession(attempt.session_id), attempt, attempt.customer_id, live)
      if (result.id !== attempt.session_id) throw new CheckoutProviderContractError()
      return result
    },
  }
}
