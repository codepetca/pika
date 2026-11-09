import { z } from 'zod'
import {
  BillingReconciliationScopeSchema,
  matchesBillingReconciliationScope,
  type BillingProviderSubscriptionSnapshot,
  type BillingReconciliationScope,
} from '@/lib/server/billing/contracts'
import { readExclusiveStripeInvoiceTax, stripeMerchantAutomaticTaxSchema, usesStripeExclusiveTax } from './billing-tax'
import type { BillingProvider } from '@/lib/server/billing/synchronize'

type ReadResource = { retrieve(id: string): Promise<unknown> }
type UnpaidInvoiceStatus = 'draft' | 'open' | 'uncollectible'
/** Supplied by the official SDK at runtime; fixtures implement this read-only seam. */
export type StripeBillingReadPort = {
  accounts: { retrieve(): Promise<unknown> }
  subscriptions: ReadResource
  invoices: ReadResource & {
    list?(input: { subscription: string; status: UnpaidInvoiceStatus; limit: 1 }): Promise<unknown>
  }
  paymentIntents: ReadResource
  charges: ReadResource
}

const referenceSchema = z.union([z.string(), z.object({ id: z.string() })])
  .transform(value => typeof value === 'string' ? value : value.id)
const timestampSchema = z.number().int().nonnegative().max(8640000000000)
  .transform(value => new Date(value * 1000).toISOString())
const stripeAccountSchema = z.object({ id: z.string() })
const stripeInvoiceListSchema = z.object({
  object: z.literal('list'), has_more: z.literal(false), data: z.array(z.unknown()),
})
const stripeSubscriptionSchema = z.object({
  id: z.string(), livemode: z.boolean(), customer: referenceSchema, status: z.string(),
  automatic_tax: z.object({ enabled: z.boolean() }).passthrough().optional(),
  pending_update: z.unknown(), cancel_at: timestampSchema.nullable(),
  cancel_at_period_end: z.boolean(), pause_collection: z.unknown(),
  schedule: referenceSchema.nullable(), latest_invoice: referenceSchema.nullable(),
  items: z.object({ has_more: z.literal(false), data: z.array(z.object({
    quantity: z.number().int(), current_period_start: timestampSchema,
    current_period_end: timestampSchema,
    price: z.object({ id: z.string(), livemode: z.boolean(), currency: z.string(),
      product: referenceSchema, unit_amount: z.number().int().nonnegative(),
      tax_behavior: z.string().nullable().optional(),
      recurring: z.object({ interval: z.string(), interval_count: z.number().int() }),
    }),
  })).max(100) }),
})
const stripePaidInvoicePaymentSchema = z.object({
  invoice: referenceSchema, livemode: z.boolean(), status: z.literal('paid'),
  amount_paid: z.number().int().positive(),
  currency: z.string().optional(),
  payment: z.object({ type: z.literal('payment_intent'), payment_intent: referenceSchema }),
})
const stripeUnpaidInvoicePaymentSchema = z.object({
  invoice: referenceSchema, livemode: z.boolean(), status: z.enum(['canceled', 'open']),
  amount_paid: z.union([z.literal(0), z.null()]),
  currency: z.string().optional(),
  payment: z.object({ type: z.literal('payment_intent'), payment_intent: referenceSchema }),
})
const stripeInvoicePaymentSchema = z.union([
  stripePaidInvoicePaymentSchema,
  stripeUnpaidInvoicePaymentSchema,
])
const stripeInvoiceSchema = z.object({
  id: z.string(), livemode: z.boolean(), customer: referenceSchema,
  automatic_tax: z.object({ enabled: z.boolean() }).optional(),
  currency: z.string(), status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']), amount_due: z.number().int(),
  amount_paid: z.number().int().nonnegative(), amount_remaining: z.number().int().nonnegative(),
  amount_paid_off_stripe: z.number().int().optional(),
  billing_reason: z.string().nullable(), subtotal: z.number().int(), total: z.number().int(),
  starting_balance: z.number().int(), ending_balance: z.number().int().nullable(),
  pre_payment_credit_notes_amount: z.number().int().nonnegative(),
  post_payment_credit_notes_amount: z.number().int().nonnegative(),
  discounts: z.array(z.unknown()).max(100),
  total_discount_amounts: z.array(z.object({ amount: z.number().int() })).max(100).nullable(),
  total_taxes: z.array(z.object({ amount: z.number().int() })).max(100).nullable(),
  parent: z.object({ subscription_details: z.object({ subscription: referenceSchema }) }),
  lines: z.object({ has_more: z.literal(false), data: z.array(z.object({
    quantity: z.number().int(), amount: z.number().int(),
    discounts: z.array(z.unknown()).max(100),
    discount_amounts: z.array(z.object({ amount: z.number().int() })).max(100).nullable(),
    taxes: z.array(z.object({ amount: z.number().int() })).max(100).nullable(),
    parent: z.object({ subscription_item_details: z.object({
      subscription: referenceSchema, proration: z.boolean(),
    }) }),
    pricing: z.object({ price_details: z.object({ price: referenceSchema }) }),
    period: z.object({ start: timestampSchema, end: timestampSchema }),
  })).max(100) }),
  payments: z.object({ has_more: z.literal(false), data: z.array(stripeInvoicePaymentSchema).max(100) }),
})
const stripePaymentIntentSchema = z.object({
  id: z.string(), livemode: z.boolean(), customer: referenceSchema,
  currency: z.string(), status: z.literal('succeeded'), amount_received: z.number().int().positive(),
  latest_charge: referenceSchema,
})
const stripeChargeSchema = z.object({
  id: z.string(), livemode: z.boolean(), customer: referenceSchema,
  currency: z.string(), payment_intent: referenceSchema, status: z.literal('succeeded'),
  paid: z.literal(true), captured: z.literal(true), refunded: z.literal(false),
  amount_refunded: z.literal(0), disputed: z.literal(false),
  amount_captured: z.number().int().positive().optional(),
  payment_method_details: z.object({ type: z.string() }),
})

async function canceledObligationsCleared(
  invoices: StripeBillingReadPort['invoices'],
  subscriptionId: string,
): Promise<boolean> {
  if (!invoices.list) return false
  let cleared = true
  for (const status of ['draft', 'open', 'uncollectible'] as const) {
    const result = stripeInvoiceListSchema.safeParse(await invoices.list({ subscription: subscriptionId, status, limit: 1 }))
    if (!result.success || result.data.data.length !== 0) cleared = false
  }
  return cleared
}

export function createStripeBillingProvider(
  sdk: StripeBillingReadPort,
  configuredScope?: BillingReconciliationScope,
): BillingProvider {
  const scope = BillingReconciliationScopeSchema.optional().parse(configuredScope)
  return {
    async retrieveSubscription(binding) {
      try {
        if (!matchesBillingReconciliationScope(binding, scope)) return null
        const liveMode = binding.provider_mode === 'live'
        const taxed = usesStripeExclusiveTax(binding)
        const account = stripeAccountSchema.parse(await sdk.accounts.retrieve())
        if (account.id !== binding.stripe_account) return null
        const subscription = stripeSubscriptionSchema.parse(
          await sdk.subscriptions.retrieve(binding.stripe_subscription_id),
        )
        if (
          subscription.id !== binding.stripe_subscription_id
          || subscription.customer !== binding.stripe_customer_id
          || subscription.livemode !== liveMode
          || subscription.items.data.some(item => item.price.livemode !== liveMode)
          || (taxed ? !stripeMerchantAutomaticTaxSchema.safeParse(subscription.automatic_tax).success
            || subscription.items.data.some(item => item.price.tax_behavior !== 'exclusive')
            : subscription.automatic_tax?.enabled === true)
        ) return null
        let latestInvoice = null
        if (subscription.latest_invoice) {
          const rawInvoice = await sdk.invoices.retrieve(subscription.latest_invoice)
          const invoice = stripeInvoiceSchema.parse(rawInvoice)
          const exclusiveTax = taxed ? readExclusiveStripeInvoiceTax(rawInvoice) : null
          if ((taxed && !exclusiveTax) || (!taxed && invoice.automatic_tax?.enabled === true)) return null
          if (invoice.id !== subscription.latest_invoice || invoice.livemode !== liveMode
            || invoice.customer !== binding.stripe_customer_id
            || invoice.parent.subscription_details.subscription !== subscription.id
            || invoice.payments.data.some(payment => payment.livemode !== liveMode
              || payment.invoice !== invoice.id || (liveMode && payment.currency !== invoice.currency))) return null
          type Invoice = NonNullable<BillingProviderSubscriptionSnapshot['latestInvoice']>
          let payments: Invoice['payments'] = []
          const modeEvidence: NonNullable<Invoice['modeEvidence']> = {
            invoice: invoice.livemode, invoicePayments: invoice.payments.data.map(payment => payment.livemode),
          }
          if (invoice.status === 'paid') {
            if (invoice.amount_remaining !== 0 || invoice.payments.data.length !== 1) return null
            const payment = stripePaidInvoicePaymentSchema.parse(invoice.payments.data[0])
            if (payment.amount_paid !== invoice.amount_due) return null
            const intent = stripePaymentIntentSchema.parse(await sdk.paymentIntents.retrieve(payment.payment.payment_intent))
            if (intent.id !== payment.payment.payment_intent || intent.livemode !== liveMode
              || intent.customer !== invoice.customer || intent.currency !== invoice.currency) return null
            const charge = stripeChargeSchema.parse(await sdk.charges.retrieve(intent.latest_charge))
            if (charge.id !== intent.latest_charge || charge.livemode !== liveMode
              || charge.customer !== invoice.customer || charge.currency !== invoice.currency || charge.payment_intent !== intent.id
              || (liveMode && charge.amount_captured !== invoice.amount_due)) return null
            modeEvidence.paidPayment = {
              paymentIntent: intent.livemode, charge: charge.livemode, amountCaptured: charge.amount_captured,
            }
            payments = [{
              type: 'payment_intent', status: intent.status, paymentIntentId: intent.id,
              customerId: intent.customer, currency: intent.currency, amountReceived: intent.amount_received,
              latestCharge: {
                status: charge.status, paid: charge.paid, captured: charge.captured,
                refunded: charge.refunded, amountRefunded: charge.amount_refunded, disputed: charge.disputed,
                customerId: charge.customer, currency: charge.currency, paymentIntentId: charge.payment_intent,
                paymentMethodType: charge.payment_method_details.type,
              },
            }]
          } else {
            if (
              invoice.amount_paid !== 0
              || (['draft', 'open'].includes(invoice.status) && invoice.amount_remaining !== invoice.amount_due)
              || (invoice.amount_paid_off_stripe !== undefined && invoice.amount_paid_off_stripe !== 0)
            ) return null
            const unpaidPayments = z.array(stripeUnpaidInvoicePaymentSchema).safeParse(invoice.payments.data)
            if (!unpaidPayments.success) return null
          }
          latestInvoice = {
            id: invoice.id, status: invoice.status, currency: invoice.currency,
            amountDue: invoice.amount_due, amountPaid: invoice.amount_paid,
            amountPaidOffStripe: invoice.amount_paid_off_stripe,
            billingReason: invoice.billing_reason,
            subtotal: invoice.subtotal, total: invoice.total,
            startingBalance: invoice.starting_balance, endingBalance: invoice.ending_balance,
            prePaymentCreditNotesAmount: invoice.pre_payment_credit_notes_amount,
            postPaymentCreditNotesAmount: invoice.post_payment_credit_notes_amount,
            totalDiscountAmount: (invoice.total_discount_amounts ?? []).reduce((sum, item) => sum + item.amount, 0),
            totalTaxAmount: (invoice.total_taxes ?? []).reduce((sum, item) => sum + item.amount, 0),
            hasDiscounts: invoice.discounts.length > 0 || (invoice.total_discount_amounts?.length ?? 0) > 0,
            hasTaxes: (invoice.total_taxes?.length ?? 0) > 0,
            ...(exclusiveTax && { exclusiveTax }),
            customerId: invoice.customer, subscriptionId: invoice.parent.subscription_details.subscription,
            linesFullyEnumerated: true,
            lines: invoice.lines.data.map(line => ({
              type: 'subscription', subscriptionId: line.parent.subscription_item_details.subscription,
              priceId: line.pricing.price_details.price, quantity: line.quantity,
              amount: line.amount,
              hasDiscounts: line.discounts.length > 0 || (line.discount_amounts?.length ?? 0) > 0,
              hasTaxes: (line.taxes?.length ?? 0) > 0,
              proration: line.parent.subscription_item_details.proration,
              periodStart: line.period.start, periodEnd: line.period.end,
            })),
            paymentsFullyEnumerated: true,
            modeEvidence,
            payments,
          }
        }
        const terminalObligationsCleared = subscription.status === 'canceled'
          ? await canceledObligationsCleared(sdk.invoices, subscription.id)
          : false
        return {
          stripeAccount: account.id, liveMode: subscription.livemode, isCurrent: true,
          subscriptionId: subscription.id, customerId: subscription.customer, status: subscription.status,
          pendingUpdate: subscription.pending_update !== null,
          cancelAt: subscription.cancel_at, cancelAtPeriodEnd: subscription.cancel_at_period_end,
          pauseCollection: subscription.pause_collection !== null, scheduleId: subscription.schedule,
          ...(taxed && { automaticTaxEnabled: true as const }),
          items: subscription.items.data.map(item => ({
            priceId: item.price.id, currency: item.price.currency, interval: item.price.recurring.interval,
            intervalCount: item.price.recurring.interval_count, priceLiveMode: item.price.livemode,
            productId: item.price.product, unitAmount: item.price.unit_amount,
            ...(taxed && { priceTaxBehavior: 'exclusive' as const }),
            quantity: item.quantity, currentPeriodStart: item.current_period_start, currentPeriodEnd: item.current_period_end,
          })),
          latestInvoice,
          terminalObligationsCleared,
        }
      } catch (error) {
        // Invalid provider shapes become durable exceptions; transport failures retry.
        if (error instanceof z.ZodError) return null
        throw error
      }
    },
  }
}
