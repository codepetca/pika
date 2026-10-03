import type Stripe from 'stripe'
import { z } from 'zod'
import { createStripeBillingProvider, type StripeBillingReadPort } from './stripe-provider'
import { verifyPaidSubscriptionSnapshot } from './synchronize'
import { UpgradeQuoteContractError, UpgradeQuoteFactsSchema, UpgradeQuoteInputSchema,
  type UpgradeQuoteProvider } from './upgrade-quote-contracts'

/** Read-only SDK seam. createPreview calculates facts without creating a payable invoice. */
export type StripeUpgradeQuotePort = Omit<StripeBillingReadPort, 'invoices'> & {
  prices: { retrieve(id: string): Promise<unknown> }
  invoices: StripeBillingReadPort['invoices'] & {
    list(input: { subscription: string; status: 'draft' | 'open' | 'uncollectible'; limit: 1 }): Promise<unknown>
    createPreview(input: Stripe.InvoiceCreatePreviewParams): Promise<unknown>
  }
}

/** SDK 22.6.2 / 2026-08-26.dahlia shapes. The owning runtime supplies the gated client. */
export function createStripeUpgradeQuotePort(stripe: Stripe): StripeUpgradeQuotePort {
  return {
    accounts: { retrieve: () => stripe.accounts.retrieve(null) },
    subscriptions: { retrieve: id => stripe.subscriptions.retrieve(id) },
    prices: { retrieve: id => stripe.prices.retrieve(id) },
    invoices: {
      retrieve: id => stripe.invoices.retrieve(id, { expand: ['payments'] }),
      list: input => stripe.invoices.list(input), createPreview: input => stripe.invoices.createPreview(input),
    },
    paymentIntents: { retrieve: id => stripe.paymentIntents.retrieve(id) },
    charges: { retrieve: id => stripe.charges.retrieve(id) },
  }
}

const reference = z.union([z.string().min(1), z.object({ id: z.string().min(1) })])
  .transform(value => typeof value === 'string' ? value : value.id)
const money = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const timestamp = z.number().int().nonnegative().max(8640000000000)
const empty = z.array(z.unknown()).length(0)
const emptyNullable = empty.nullable()
const priceSchema = z.object({
  id: reference, livemode: z.literal(false), active: z.boolean(), product: reference, currency: z.string(),
  unit_amount: money.positive(), unit_amount_decimal: z.string().regex(/^\d+(?:\.0+)?$/),
  billing_scheme: z.literal('per_unit'), type: z.literal('recurring'),
  recurring: z.object({ interval: z.enum(['month', 'year']), interval_count: z.literal(1), usage_type: z.literal('licensed') }),
  custom_unit_amount: z.null(), transform_quantity: z.null(),
  // Tax behavior is price metadata; inclusive tax cannot be a baseline undiscounted price.
  tax_behavior: z.enum(['exclusive', 'unspecified']).nullable(),
}).refine(price => Number(price.unit_amount_decimal) === price.unit_amount)
const subscriptionSchema = z.object({
  id: reference, livemode: z.literal(false), customer: reference, status: z.literal('active'),
  pending_update: z.null(), cancel_at: z.null(), cancel_at_period_end: z.literal(false),
  pause_collection: z.null(), schedule: z.null(), latest_invoice: reference,
  collection_method: z.literal('charge_automatically'), automatic_tax: z.object({ enabled: z.literal(false) }),
  discounts: empty, default_tax_rates: emptyNullable, pending_invoice_item_interval: z.null(),
  items: z.object({ has_more: z.literal(false), data: z.array(z.object({
    id: reference, quantity: z.literal(1), current_period_start: timestamp, current_period_end: timestamp,
    price: priceSchema, discounts: empty, tax_rates: emptyNullable, billing_thresholds: z.null(),
  })).length(1) }),
})
const previewSchema = z.object({
  livemode: z.literal(false), status: z.literal('draft'), customer: reference, currency: z.string(),
  amount_due: money.nonnegative(), amount_paid: z.literal(0), amount_remaining: money.nonnegative(),
  amount_paid_off_stripe: z.literal(0).optional(), amount_shipping: z.literal(0),
  subtotal: money.nonnegative(), total: money.nonnegative(), starting_balance: z.literal(0), ending_balance: z.literal(0).nullable(),
  automatic_tax: z.object({ enabled: z.literal(false) }), default_tax_rates: empty,
  discounts: empty, total_discount_amounts: emptyNullable, total_taxes: emptyNullable,
  total_pretax_credit_amounts: emptyNullable, pre_payment_credit_notes_amount: z.literal(0),
  post_payment_credit_notes_amount: z.literal(0),
  parent: z.object({ type: z.literal('subscription_details'), subscription_details: z.object({ subscription: reference }) }),
  lines: z.object({ has_more: z.literal(false), data: z.array(z.object({
    id: reference, livemode: z.literal(false), amount: money, subtotal: money,
    currency: z.string(), quantity: z.literal(1), quantity_decimal: z.string().regex(/^1(?:\.0+)?$/),
    discounts: empty, discount_amounts: emptyNullable, taxes: emptyNullable, pretax_credit_amounts: emptyNullable,
    parent: z.object({ type: z.literal('subscription_item_details'), subscription_item_details: z.object({
      subscription: reference, subscription_item: reference, proration: z.literal(true),
    }) }),
    pricing: z.object({ type: z.literal('price_details'), price_details: z.object({ price: reference }) }),
    period: z.object({ start: timestamp, end: timestamp }),
  })).length(2) }),
})
const invoiceListSchema = z.object({ object: z.literal('list'), has_more: z.literal(false), data: empty })
// Additional dahlia commercial fields omitted by the foundation snapshot must
// also be clean before its verified paid term can supply unused-time credit.
const paidInvoiceTermsSchema = z.object({
  amount_shipping: z.literal(0), automatic_tax: z.object({ enabled: z.literal(false) }),
  default_tax_rates: empty, total_pretax_credit_amounts: emptyNullable,
  lines: z.object({ has_more: z.literal(false), data: z.array(z.object({
    livemode: z.literal(false), currency: z.string(), quantity_decimal: z.string().regex(/^1(?:\.0+)?$/),
    pretax_credit_amounts: emptyNullable,
  })).length(1) }),
})
const tierRank = { basic: 0, plus: 1, pro: 2 } as const
const iso = (seconds: number) => new Date(seconds * 1000).toISOString()

function requireContract(condition: boolean): asserts condition {
  if (!condition) throw new UpgradeQuoteContractError()
}

export function createStripeUpgradeQuoteProvider(port: StripeUpgradeQuotePort): UpgradeQuoteProvider {
  return {
    async prepareQuote(candidate) {
      try {
        const input = UpgradeQuoteInputSchema.parse(candidate)
        const { binding, target, lifecycle } = input
        const now = Date.parse(input.now)
        const prorationDate = Math.floor(now / 1000)
        requireContract(tierRank[target.plan_key] > tierRank[binding.plan_key]
          && target.stripe_account === binding.stripe_account && target.currency === binding.currency
          && target.interval === binding.interval && target.unit_amount > binding.unit_amount
          && target.stripe_price_id !== binding.stripe_price_id && target.offering_version_id !== binding.offering_version_id
          && now >= Date.parse(lifecycle.paidPeriodStart) && now < Date.parse(lifecycle.paidThrough))
        const account = z.object({ id: reference }).parse(await port.accounts.retrieve())
        requireContract(account.id === binding.stripe_account)
        const rawSubscription = await port.subscriptions.retrieve(binding.stripe_subscription_id)
        const subscription = subscriptionSchema.parse(rawSubscription)
        const item = subscription.items.data[0]
        requireContract(subscription.id === binding.stripe_subscription_id && subscription.customer === binding.stripe_customer_id
          && subscription.latest_invoice === lifecycle.lastPaidInvoiceId
          && item.current_period_start * 1000 === Date.parse(lifecycle.paidPeriodStart)
          && item.current_period_end * 1000 === Date.parse(lifecycle.paidThrough))

        // Reuse the captured-card proof without another account/subscription read. The
        // initial slice supports original/cycle paid terms. A prior upgrade needs
        // its independently verified receipt contract; no invoice is relabeled here.
        const snapshot = await createStripeBillingProvider({ ...port,
          accounts: { retrieve: async () => account }, subscriptions: { retrieve: async () => rawSubscription },
          invoices: { ...port.invoices, retrieve: async id => {
            const rawInvoice = await port.invoices.retrieve(id)
            const terms = paidInvoiceTermsSchema.parse(rawInvoice)
            requireContract(terms.lines.data[0].currency === binding.currency)
            return rawInvoice
          } },
        }).retrieveSubscription(binding)
        const paid = verifyPaidSubscriptionSnapshot(binding, snapshot)
        requireContract(typeof paid !== 'string' && paid.invoiceId === lifecycle.lastPaidInvoiceId
          && Date.parse(paid.periodStart) === Date.parse(lifecycle.paidPeriodStart)
          && Date.parse(paid.periodEnd) === Date.parse(lifecycle.paidThrough))

        const price = priceSchema.parse(await port.prices.retrieve(target.stripe_price_id))
        requireContract(price.active && price.id === target.stripe_price_id && price.product === target.stripe_product_id
          && price.unit_amount === target.unit_amount && price.currency === target.currency && price.recurring.interval === target.interval)
        for (const status of ['draft', 'open', 'uncollectible'] as const) {
          invoiceListSchema.parse(await port.invoices.list({ subscription: binding.stripe_subscription_id, status, limit: 1 }))
        }
        const preview = previewSchema.parse(await port.invoices.createPreview({
          customer: binding.stripe_customer_id, subscription: binding.stripe_subscription_id, preview_mode: 'next',
          subscription_details: { billing_cycle_anchor: 'unchanged', proration_behavior: 'always_invoice',
            proration_date: prorationDate, items: [{ id: item.id, price: target.stripe_price_id, quantity: 1 }] },
        }))
        const credit = preview.lines.data.find(line => line.pricing.price_details.price === binding.stripe_price_id)
        const debit = preview.lines.data.find(line => line.pricing.price_details.price === target.stripe_price_id)
        requireContract(!!credit && !!debit && credit.id !== debit.id)
        requireContract(preview.customer === binding.stripe_customer_id && preview.currency === binding.currency
          && preview.parent.subscription_details.subscription === binding.stripe_subscription_id
          && preview.amount_due === preview.total && preview.subtotal === preview.total
          && preview.amount_remaining === preview.amount_due
          && preview.lines.data.every(line => line.currency === binding.currency && line.amount === line.subtotal
            && line.parent.subscription_item_details.subscription === binding.stripe_subscription_id
            && line.parent.subscription_item_details.subscription_item === item.id
            && line.period.start === prorationDate && line.period.end === item.current_period_end))
        return UpgradeQuoteFactsSchema.parse({
          binding, target, subscriptionItemId: item.id, prorationDate, quotedAt: new Date(now).toISOString(),
          paidPeriodStart: iso(item.current_period_start), paidThrough: iso(item.current_period_end),
          expiresAt: new Date(Math.min(now + 15 * 60 * 1000, item.current_period_end * 1000)).toISOString(),
          unusedCreditAmount: credit.amount, remainingChargeAmount: debit.amount, amountDue: preview.amount_due,
          currency: binding.currency, nextRecurringAmount: target.unit_amount,
          lines: [credit, debit].map((line, index) => ({ kind: index === 0 ? 'old_credit' : 'target_debit',
            priceId: line.pricing.price_details.price, subscriptionItemId: item.id, amount: line.amount,
            quantity: 1, periodStart: iso(line.period.start), periodEnd: iso(line.period.end) })),
          paymentState: preview.amount_due === 0 ? 'zero_due' : 'payment_required',
        })
      } catch (error) {
        if (error instanceof z.ZodError) throw new UpgradeQuoteContractError()
        throw error
      }
    },
  }
}
