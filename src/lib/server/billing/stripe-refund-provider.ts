import type Stripe from 'stripe'
import { z } from 'zod'
import { readExclusiveStripeInvoiceTax } from './billing-tax'

export type LiveStripeFullRefundEvidence = {
  stripe_subscription_id: string
  stripe_customer_id: string
  invoice_id: string
  charge_id: string
  refund_ids: string[]
  currency: 'cad' | 'usd'
  gross_amount: number
  base_amount: number
  price_id: string
  paid_period_start: string
  paid_through: string
}

const id = z.union([z.string().min(1), z.object({ id: z.string().min(1) })])
  .transform(value => typeof value === 'string' ? value : value.id)
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const positive = money.refine(value => value > 0)
const timestamp = z.number().int().nonnegative().max(8640000000)
const empty = z.array(z.never()).nullable()
const list = <T extends z.ZodTypeAny>(item: T) => z.object({
  object: z.literal('list'), has_more: z.literal(false), data: z.array(item).max(100),
})
const subscriptionSchema = z.object({
  id, customer: id, livemode: z.literal(true), status: z.literal('canceled'), latest_invoice: id,
})
const lineSchema = z.object({
  amount: positive, quantity: z.literal(1), discounts: z.array(z.never()), discount_amounts: empty,
  taxes: z.array(z.unknown()).nullable(), pretax_credit_amounts: z.array(z.never()).nullish(),
  parent: z.object({ subscription_item_details: z.object({ subscription: id, proration: z.literal(false) }) }),
  pricing: z.object({ price_details: z.object({ price: id }) }),
  period: z.object({ start: timestamp, end: timestamp }),
})
const invoiceSchema = z.object({
  id, customer: id, livemode: z.literal(true), status: z.literal('paid'), currency: z.enum(['cad', 'usd']),
  parent: z.object({ subscription_details: z.object({ subscription: id }) }),
  subtotal: positive, total: positive, amount_due: positive, amount_paid: positive,
  amount_remaining: z.literal(0), amount_paid_off_stripe: z.literal(0).optional(),
  starting_balance: z.literal(0), ending_balance: z.literal(0),
  pre_payment_credit_notes_amount: z.literal(0), post_payment_credit_notes_amount: money,
  discounts: z.array(z.never()), total_discount_amounts: empty,
  automatic_tax: z.object({ enabled: z.boolean() }), total_taxes: z.array(z.unknown()).nullable(),
  total_pretax_credit_amounts: z.array(z.never()).nullish(),
  lines: list(lineSchema),
})
const paymentSchema = z.object({
  livemode: z.literal(true), invoice: id, status: z.literal('paid'), amount_paid: positive,
  currency: z.enum(['cad', 'usd']), payment: z.object({ type: z.literal('payment_intent'), payment_intent: id }),
})
const intentSchema = z.object({
  id, livemode: z.literal(true), customer: id, status: z.literal('succeeded'), currency: z.enum(['cad', 'usd']),
  amount_received: positive, latest_charge: id,
})
const chargeSchema = z.object({
  id, livemode: z.literal(true), customer: id, payment_intent: id, currency: z.enum(['cad', 'usd']),
  status: z.literal('succeeded'), paid: z.literal(true), captured: z.literal(true), refunded: z.literal(true),
  disputed: z.literal(false), amount: positive, amount_captured: positive, amount_refunded: positive,
  payment_method_details: z.object({ type: z.literal('card') }),
})
const refundSchema = z.object({
  id, charge: id, currency: z.enum(['cad', 'usd']), amount: positive,
  status: z.enum(['succeeded', 'failed', 'canceled']),
})

/** Fresh read-only evidence; an absent or ambiguous provider fact never authorizes a refund grant. */
export async function verifyLiveStripeFullRefund(
  stripe: Stripe,
  input: { stripeAccount: string; stripeSubscriptionId: string; stripeInvoiceId: string },
): Promise<LiveStripeFullRefundEvidence | null> {
  try {
    if (!input.stripeAccount || !input.stripeSubscriptionId || !input.stripeInvoiceId) return null
    const account = z.object({ id }).parse(await stripe.accounts.retrieve(null))
    if (account.id !== input.stripeAccount) return null
    const sub = subscriptionSchema.parse(await stripe.subscriptions.retrieve(input.stripeSubscriptionId))
    if (sub.id !== input.stripeSubscriptionId || sub.latest_invoice !== input.stripeInvoiceId) return null
    for (const status of ['draft', 'open', 'uncollectible'] as const) {
      const obligations = list(z.unknown()).parse(await stripe.invoices.list({ subscription: sub.id, status, limit: 1 }))
      if (obligations.data.length) return null
    }
    const raw = await stripe.invoices.retrieve(input.stripeInvoiceId)
    const invoice = invoiceSchema.parse(raw)
    if (invoice.id !== input.stripeInvoiceId || invoice.customer !== sub.customer
      || invoice.parent.subscription_details.subscription !== sub.id || invoice.lines.data.length !== 1) return null
    const line = invoice.lines.data[0]
    if (line.parent.subscription_item_details.subscription !== sub.id || line.period.end <= line.period.start
      || line.amount !== invoice.subtotal || invoice.total !== invoice.amount_due || invoice.total !== invoice.amount_paid
      || invoice.post_payment_credit_notes_amount > invoice.total) return null
    if (invoice.automatic_tax.enabled) {
      const tax = readExclusiveStripeInvoiceTax(raw)
      if (!tax || tax.status !== 'complete' || tax.subtotal !== invoice.subtotal) return null
    } else if ((invoice.total_taxes?.length ?? 0) !== 0 || (line.taxes?.length ?? 0) !== 0
      || invoice.total !== invoice.subtotal) return null
    const payments = list(paymentSchema).parse(await stripe.invoicePayments.list({ invoice: invoice.id, limit: 100 }))
    if (payments.data.length !== 1) return null
    const payment = payments.data[0]
    if (payment.invoice !== invoice.id || payment.currency !== invoice.currency || payment.amount_paid !== invoice.total) return null
    const intent = intentSchema.parse(await stripe.paymentIntents.retrieve(payment.payment.payment_intent))
    if (intent.id !== payment.payment.payment_intent || intent.customer !== sub.customer
      || intent.currency !== invoice.currency || intent.amount_received !== invoice.total) return null
    const charge = chargeSchema.parse(await stripe.charges.retrieve(intent.latest_charge))
    if (charge.id !== intent.latest_charge || charge.customer !== sub.customer || charge.payment_intent !== intent.id
      || charge.currency !== invoice.currency || charge.amount !== invoice.total || charge.amount_captured !== invoice.total
      || charge.amount_refunded !== invoice.total) return null
    const disputes = list(z.unknown()).parse(await stripe.disputes.list({ charge: charge.id, limit: 100 }))
    if (disputes.data.length) return null
    const refunds = list(refundSchema).parse(await stripe.refunds.list({ charge: charge.id, limit: 100 }))
    if (refunds.data.some(refund => refund.charge !== charge.id || refund.currency !== invoice.currency)
      || new Set(refunds.data.map(refund => refund.id)).size !== refunds.data.length) return null
    const succeeded = refunds.data.filter(refund => refund.status === 'succeeded')
    if (succeeded.reduce((sum, refund) => sum + refund.amount, 0) !== invoice.total) return null
    return {
      stripe_subscription_id: sub.id, stripe_customer_id: sub.customer, invoice_id: invoice.id,
      charge_id: charge.id, refund_ids: succeeded.map(refund => refund.id), currency: invoice.currency,
      gross_amount: invoice.total, base_amount: invoice.subtotal, price_id: line.pricing.price_details.price,
      paid_period_start: new Date(line.period.start * 1000).toISOString(), paid_through: new Date(line.period.end * 1000).toISOString(),
    }
  } catch {
    return null
  }
}
