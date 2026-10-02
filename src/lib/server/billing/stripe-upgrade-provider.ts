import Stripe from 'stripe'
import { z } from 'zod'
import { UpgradeOperationSchema, UpgradeProviderContractError, type UpgradeMutation, type UpgradeOperation, type UpgradeProvider,
  type UpgradeProviderEvidence } from './upgrade-contracts'
import { type UpgradeQuoteFacts } from './upgrade-quote-contracts'
import { createStripeUpgradeQuotePort, createStripeUpgradeQuoteProvider, type StripeUpgradeQuotePort } from './stripe-upgrade-quote-provider'
import { createStripeBillingProvider } from './stripe-provider'
import { verifyPaidSubscriptionSnapshot } from './synchronize'

type PostOptions = { idempotencyKey: string }
/** Only the gated runtime supplies the pinned SDK; this seam also accepts deterministic fixtures. */
export type StripeUpgradePort = Omit<StripeUpgradeQuotePort, 'subscriptions' | 'invoices'> & {
  subscriptions: StripeUpgradeQuotePort['subscriptions'] & {
    update(id: string, input: Stripe.SubscriptionUpdateParams, options: PostOptions): Promise<unknown>
  }
  invoices: StripeUpgradeQuotePort['invoices'] & {
    create(input: Stripe.InvoiceCreateParams, options: PostOptions): Promise<unknown>
    finalizeInvoice(id: string, input: Stripe.InvoiceFinalizeInvoiceParams, options: PostOptions): Promise<unknown>
    pay(id: string, input: Stripe.InvoicePayParams, options: PostOptions): Promise<unknown>
    voidInvoice(id: string, input: Stripe.InvoiceVoidInvoiceParams, options: PostOptions): Promise<unknown>
  }
  invoiceItems: { create(input: Stripe.InvoiceItemCreateParams, options: PostOptions): Promise<unknown> }
}

/** Required expansions stay with the pinned SDK boundary; no client is constructed here. */
export function createStripeUpgradePort(stripe: Stripe): StripeUpgradePort {
  const reads = createStripeUpgradeQuotePort(stripe)
  return { ...reads,
    subscriptions: { ...reads.subscriptions, update: (id, input, options) => stripe.subscriptions.update(id, input, options) },
    invoices: { ...reads.invoices,
      create: (input, options) => stripe.invoices.create(input, options),
      finalizeInvoice: (id, input, options) => stripe.invoices.finalizeInvoice(id, input, options),
      pay: (id, input, options) => stripe.invoices.pay(id, input, options),
      voidInvoice: (id, input, options) => stripe.invoices.voidInvoice(id, input, options),
    },
    invoiceItems: { create: (input, options) => stripe.invoiceItems.create(input, options) },
  }
}

export { UpgradeProviderContractError } from './upgrade-contracts'
const ref = z.union([z.string().min(1), z.object({ id: z.string().min(1) })])
  .transform(value => typeof value === 'string' ? value : value.id)
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
const money = integer.nonnegative()
const empty = z.array(z.unknown()).length(0)
const timestamp = money.max(8640000000000)
const priceSchema = z.object({ id: ref, product: ref, livemode: z.literal(false), currency: z.string(), unit_amount: money.positive(),
  billing_scheme: z.literal('per_unit'), type: z.literal('recurring'), custom_unit_amount: z.null(), transform_quantity: z.null(),
  tax_behavior: z.enum(['exclusive', 'unspecified']).nullable(),
  recurring: z.object({ interval: z.enum(['month', 'year']), interval_count: z.literal(1), usage_type: z.literal('licensed') }) })
const subscriptionSchema = z.object({ id: ref, customer: ref, livemode: z.literal(false), status: z.literal('active'),
  pending_update: z.null(), cancel_at: z.null(), cancel_at_period_end: z.literal(false), pause_collection: z.null(), schedule: z.null(),
  collection_method: z.literal('charge_automatically'), automatic_tax: z.object({ enabled: z.literal(false) }),
  discounts: empty, default_tax_rates: empty.nullable(), pending_invoice_item_interval: z.null(),
  items: z.object({ has_more: z.literal(false), data: z.array(z.object({ id: ref, quantity: z.literal(1),
    current_period_start: timestamp, current_period_end: timestamp, price: priceSchema,
    discounts: empty, tax_rates: empty.nullable(), billing_thresholds: z.null() })).length(1) }) })
const invoiceLineSchema = z.object({ id: ref, livemode: z.literal(false), amount: integer, subtotal: integer,
  currency: z.string(), quantity: z.literal(1), quantity_decimal: z.string().regex(/^1(?:\.0+)?$/),
  discounts: empty, discount_amounts: empty.nullable(), taxes: empty.nullable(), pretax_credit_amounts: empty.nullable(),
  parent: z.object({ type: z.literal('invoice_item_details'), invoice_item_details: z.object({ invoice_item: ref,
    subscription: ref, proration: z.literal(false) }) }),
  // Direct-amount invoice items legitimately have null pricing. The stored provider
  // quote and exact dedicated invoice bind amounts; neither metadata nor a price label does.
  pricing: z.unknown(), period: z.object({ start: timestamp, end: timestamp }) })
const paymentSchema = z.object({ invoice: ref, livemode: z.literal(false), currency: z.string(),
  status: z.enum(['open', 'paid', 'canceled']), amount_paid: money.nullable(), amount_requested: money,
  payment: z.object({ type: z.literal('payment_intent'), payment_intent: ref }) })
const invoiceSchema = z.object({ id: ref, livemode: z.literal(false), status: z.enum(['draft', 'open', 'paid', 'void']),
  customer: ref, currency: z.string(), auto_advance: z.literal(false), collection_method: z.literal('charge_automatically'),
  billing_reason: z.literal('manual'), amount_due: money, amount_paid: money, amount_remaining: money,
  amount_paid_off_stripe: z.literal(0).optional(), amount_shipping: z.literal(0), subtotal: integer, total: integer,
  starting_balance: z.literal(0), ending_balance: z.literal(0).nullable(), automatic_tax: z.object({ enabled: z.literal(false) }),
  default_tax_rates: empty, discounts: empty, total_discount_amounts: empty.nullable(), total_taxes: empty.nullable(),
  total_pretax_credit_amounts: empty.nullable(), pre_payment_credit_notes_amount: z.literal(0), post_payment_credit_notes_amount: z.literal(0),
  parent: z.object({ type: z.literal('subscription_details'), subscription_details: z.object({ subscription: ref }) }),
  lines: z.object({ has_more: z.literal(false), data: z.array(invoiceLineSchema).max(2) }),
  payments: z.object({ has_more: z.literal(false), data: z.array(paymentSchema).max(1) }) })
const intentSchema = z.object({ id: ref, livemode: z.literal(false), customer: ref, currency: z.string(), amount: money,
  amount_received: money, amount_capturable: money, latest_charge: ref.nullable(),
  status: z.enum(['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']),
  payment_method_types: z.tuple([z.literal('card')]) })
const chargeSchema = z.object({ id: ref, livemode: z.literal(false), customer: ref, currency: z.string(), payment_intent: ref,
  amount: money, amount_captured: money, status: z.enum(['failed', 'pending', 'succeeded']), paid: z.boolean(), captured: z.boolean(),
  refunded: z.literal(false), amount_refunded: z.literal(0), disputed: z.literal(false), payment_method_details: z.object({ type: z.literal('card') }) })
type Invoice = z.infer<typeof invoiceSchema>
type QuotedOperation = UpgradeOperation & { quote: UpgradeQuoteFacts }
function requireFact(condition: boolean, reason = 'incomplete_evidence'): asserts condition {
  if (!condition) throw new UpgradeProviderContractError(reason)
}
function decode<Schema extends z.ZodType>(schema: Schema, raw: unknown): z.output<Schema> {
  const parsed = schema.safeParse(raw)
  requireFact(parsed.success)
  return parsed.data
}
function quoted(candidate: UpgradeOperation): QuotedOperation {
  const operation = decode(UpgradeOperationSchema, candidate)
  const quote = operation.quote
  requireFact(quote !== null && operation.subscription_id === operation.source_binding.subscription_id
    && operation.subject_user_id === operation.source_binding.subject_user_id, 'identity_mismatch')
  requireFact(JSON.stringify(quote.binding) === JSON.stringify(operation.source_binding)
    && JSON.stringify(quote.target) === JSON.stringify(operation.target)
    && Date.parse(quote.paidPeriodStart) === Date.parse(operation.paid_period_start)
    && Date.parse(quote.paidThrough) === Date.parse(operation.paid_through), 'quote_mismatch')
  requireFact(quote.amountDue > 0, 'zero_payment_unapproved')
  return { ...operation, quote }
}
function unexpired(operation: QuotedOperation): boolean {
  return Date.now() < Math.min(Date.parse(operation.expires_at), Date.parse(operation.quote.expiresAt))
}
function invoiceIdentity(invoice: Invoice, operation: QuotedOperation, id: string): void {
  requireFact(invoice.id === id && invoice.customer === operation.source_binding.stripe_customer_id
    && invoice.parent.subscription_details.subscription === operation.source_binding.stripe_subscription_id
    && invoice.currency === operation.quote.currency, 'identity_mismatch')
}
function matchingLine(actual: z.infer<typeof invoiceLineSchema>, expected: UpgradeQuoteFacts['lines'][number], operation: QuotedOperation): boolean {
  return actual.amount === expected.amount && actual.subtotal === expected.amount && actual.currency === operation.quote.currency
    && actual.parent.invoice_item_details.subscription === operation.source_binding.stripe_subscription_id
    && actual.period.start * 1000 === Date.parse(expected.periodStart) && actual.period.end * 1000 === Date.parse(expected.periodEnd)
}
function validateLines(invoice: Invoice, operation: QuotedOperation, partial = false): void {
  const matches = operation.quote.lines.map(expected => invoice.lines.data.filter(actual => matchingLine(actual, expected, operation)).length)
  requireFact(matches.every(count => count <= 1) && matches.reduce((sum, count) => sum + count, 0) === invoice.lines.data.length
    && (partial || matches.every(count => count === 1)), 'quote_mismatch')
  if (!partial) requireFact(invoice.subtotal === operation.quote.amountDue && invoice.total === operation.quote.amountDue
    && invoice.amount_due === operation.quote.amountDue && (invoice.status === 'draft' || invoice.ending_balance === 0), 'quote_mismatch')
}

export function createStripeUpgradeProvider(port: StripeUpgradePort): UpgradeProvider {
  const quoteProvider = createStripeUpgradeQuoteProvider(port)
  async function accountIdentity(operation: QuotedOperation) {
    const account = decode(z.object({ id: ref }), await port.accounts.retrieve())
    requireFact(account.id === operation.source_binding.stripe_account, 'identity_mismatch')
  }
  async function current(operation: QuotedOperation) {
    const binding = operation.source_binding
    await accountIdentity(operation)
    const subscription = decode(subscriptionSchema, await port.subscriptions.retrieve(binding.stripe_subscription_id))
    const item = subscription.items.data[0]
    requireFact(subscription.id === binding.stripe_subscription_id && subscription.customer === binding.stripe_customer_id
      && item.id === operation.quote.subscriptionItemId, 'identity_mismatch')
    requireFact(item.current_period_start * 1000 === Date.parse(operation.paid_period_start)
      && item.current_period_end * 1000 === Date.parse(operation.paid_through)
      && Date.now() < Date.parse(operation.paid_through), 'renewal_boundary_crossed')
    const targetApplied = item.price.id === operation.target.stripe_price_id
    const expected = targetApplied ? operation.target : binding
    requireFact(item.price.id === expected.stripe_price_id && item.price.product === expected.stripe_product_id
      && item.price.unit_amount === expected.unit_amount && item.price.currency === expected.currency
      && item.price.recurring.interval === expected.interval, 'identity_mismatch')
    const target = decode(priceSchema, await port.prices.retrieve(operation.target.stripe_price_id))
    requireFact(target.id === operation.target.stripe_price_id && target.product === operation.target.stripe_product_id
      && target.unit_amount === operation.target.unit_amount && target.currency === operation.target.currency
      && target.recurring.interval === operation.target.interval, 'identity_mismatch')
    return { subscription, targetApplied }
  }
  async function readInvoice(operation: QuotedOperation, id: string, partial = false) {
    const invoice = decode(invoiceSchema, await port.invoices.retrieve(id))
    invoiceIdentity(invoice, operation, id); validateLines(invoice, operation, partial && invoice.status === 'draft')
    return invoice
  }
  async function verifySourcePayment(operation: QuotedOperation) {
    // Read the recorded historical paid invoice explicitly. A manual upgrade
    // invoice may replace latest_invoice, but that pointer never invalidates or
    // proves payment of the original term. The actual current item stays intact.
    const historicalReader = createStripeBillingProvider({ ...port,
      subscriptions: { retrieve: async id => ({
        ...subscriptionSchema.parse(await port.subscriptions.retrieve(id)), latest_invoice: operation.last_paid_invoice_id,
      }) },
      paymentIntents: { retrieve: async id => {
        const raw = await port.paymentIntents.retrieve(id)
        const intent = decode(intentSchema, raw)
        requireFact(intent.amount === operation.source_binding.unit_amount && intent.amount_capturable === 0, 'source_payment_unverified')
        return raw
      } },
      charges: { retrieve: async id => {
        const raw = await port.charges.retrieve(id)
        const charge = decode(chargeSchema, raw)
        requireFact(charge.amount === operation.source_binding.unit_amount && charge.amount_captured === operation.source_binding.unit_amount,
          'source_payment_unverified')
        return raw
      } },
    })
    const evidence = verifyPaidSubscriptionSnapshot(operation.source_binding, await historicalReader.retrieveSubscription(operation.source_binding))
    requireFact(typeof evidence !== 'string' && evidence.invoiceId === operation.last_paid_invoice_id
      && Date.parse(evidence.periodStart) === Date.parse(operation.paid_period_start)
      && Date.parse(evidence.periodEnd) === Date.parse(operation.paid_through), 'source_payment_unverified')
  }
  async function paymentEvidence(invoice: Invoice, operation: QuotedOperation): Promise<'unpaid' | 'pending' | string> {
    const amount = operation.quote.amountDue
    if (invoice.status === 'paid') requireFact(operation.confirmed, 'unconfirmed_payment')
    requireFact(invoice.amount_paid === 0 || invoice.amount_paid === amount, 'partial_payment')
    const payment = invoice.payments.data[0]
    if (!payment) {
      requireFact(invoice.status !== 'paid' && invoice.amount_paid === 0
        && invoice.amount_remaining === (invoice.status === 'void' ? 0 : amount), 'incomplete_evidence')
      return 'unpaid'
    }
    requireFact(payment.invoice === invoice.id && payment.currency === operation.quote.currency
      && payment.amount_requested === amount, 'identity_mismatch')
    const intent = intentSchema.parse(await port.paymentIntents.retrieve(payment.payment.payment_intent))
    requireFact(intent.id === payment.payment.payment_intent && intent.customer === operation.source_binding.stripe_customer_id
      && intent.currency === operation.quote.currency && intent.amount === amount, 'identity_mismatch')
    requireFact((intent.amount_received === 0 || intent.amount_received === amount)
      && ((payment.amount_paid ?? 0) === 0 || payment.amount_paid === amount), 'partial_payment')
    let charge: z.infer<typeof chargeSchema> | null = null
    if (intent.latest_charge) {
      charge = chargeSchema.parse(await port.charges.retrieve(intent.latest_charge))
      requireFact(charge.id === intent.latest_charge && charge.customer === operation.source_binding.stripe_customer_id
        && charge.currency === operation.quote.currency && charge.payment_intent === intent.id && charge.amount === amount, 'identity_mismatch')
    }
    if (invoice.status === 'paid') {
      requireFact(invoice.amount_paid === amount && invoice.amount_remaining === 0 && payment.status === 'paid'
        && payment.amount_paid === amount && intent.status === 'succeeded' && intent.amount_received === amount
        && intent.amount_capturable === 0 && charge !== null && charge.status === 'succeeded' && charge.paid
        && charge.captured && charge.amount_captured === amount, 'unsupported_payment')
      requireFact(operation.payment_intent_id === null || operation.payment_intent_id === intent.id, 'identity_mismatch')
      return intent.id
    }
    requireFact(invoice.amount_paid === 0, 'partial_payment')
    if (payment.status === 'paid' || intent.amount_received > 0 || intent.amount_capturable > 0
      || !['requires_payment_method', 'canceled'].includes(intent.status)
      || (charge !== null && (charge.status !== 'failed' || charge.paid || charge.captured || charge.amount_captured !== 0))) return 'pending'
    requireFact(invoice.amount_remaining === (invoice.status === 'void' ? 0 : amount), 'unexpected_money')
    if (invoice.status === 'void') requireFact(intent.status === 'canceled' && payment.status === 'canceled', 'incomplete_evidence')
    return 'unpaid'
  }
  async function readEvidence(candidate: UpgradeOperation): Promise<UpgradeProviderEvidence> {
    try {
      const operation = quoted(candidate)
      requireFact(operation.invoice_id !== null, 'invoice_missing')
      const cleanup = operation.stage === 'void_requested'
      const state = cleanup ? (await accountIdentity(operation), { targetApplied: false }) : await current(operation)
      const invoice = await readInvoice(operation, operation.invoice_id, cleanup)
      const payment = await paymentEvidence(invoice, operation)
      if (cleanup && payment !== 'unpaid') return { kind: 'attention', reason: payment === 'pending' ? 'payment_pending_at_expiry' : 'unexpected_payment_at_expiry' }
      if (payment === 'pending') return { kind: 'payment_pending', invoiceId: invoice.id }
      if (payment !== 'unpaid') return { kind: 'paid', targetApplied: state.targetApplied, evidence: {
        invoiceId: invoice.id, paymentIntentId: payment, subscriptionId: operation.source_binding.stripe_subscription_id,
        paymentState: 'paid', providerStatus: 'active', amountPaid: operation.quote.amountDue, currency: operation.quote.currency,
        subscriptionItemId: operation.quote.subscriptionItemId, targetPriceId: operation.target.stripe_price_id,
        paidPeriodStart: operation.paid_period_start, paidThrough: operation.paid_through,
      } }
      requireFact(!state.targetApplied, 'unpaid_target_change')
      if (invoice.status === 'void') return { kind: 'voided', invoiceId: invoice.id }
      requireFact(invoice.status === 'draft' || invoice.status === 'open', 'incomplete_evidence')
      return { kind: 'unpaid', invoiceId: invoice.id, status: invoice.status, quote: operation.quote }
    } catch (error) {
      if (error instanceof UpgradeProviderContractError) return { kind: 'attention', reason: error.reason }
      if (error instanceof z.ZodError) return { kind: 'attention', reason: 'incomplete_evidence' }
      throw error
    }
  }
  async function guard(input: UpgradeMutation) {
    requireFact(typeof input.idempotencyKey === 'string' && input.idempotencyKey.length > 0 && input.idempotencyKey.length <= 220)
    return await input.beforeMutation() === true
  }
  const provider: UpgradeProvider = {
    prepareQuote: (operation, now) => quoteProvider.prepareQuote({ binding: operation.source_binding, target: operation.target,
      lifecycle: { paidPeriodStart: operation.paid_period_start, paidThrough: operation.paid_through, lastPaidInvoiceId: operation.last_paid_invoice_id }, now }),
    readEvidence,
    async createInvoice(input) {
      const operation = quoted(input.operation)
      requireFact(operation.stage === 'invoice_requested', 'invoice_intent_missing')
      const recoveryDeadline = Math.min(Date.parse(operation.quote.quotedAt) + 23 * 60 * 60 * 1000, Date.parse(operation.paid_through))
      requireFact(Date.now() < recoveryDeadline, 'idempotency_window_elapsed')
      const state = await current(operation)
      requireFact(!state.targetApplied, 'unpaid_target_change')
      await verifySourcePayment(operation)
      if (operation.invoice_id) return { invoiceId: operation.invoice_id }
      requireFact(await guard(input), 'lost_claim')
      requireFact(Date.now() < recoveryDeadline, 'idempotency_window_elapsed')
      const created = decode(z.object({ id: z.string().regex(/^in_[A-Za-z0-9]+$/) }), await port.invoices.create({
        customer: operation.source_binding.stripe_customer_id, subscription: operation.source_binding.stripe_subscription_id,
        currency: operation.quote.currency, auto_advance: false, pending_invoice_items_behavior: 'exclude', collection_method: 'charge_automatically',
        automatic_tax: { enabled: false }, discounts: '', default_tax_rates: [], payment_settings: { payment_method_types: ['card'] },
      }, { idempotencyKey: input.idempotencyKey }))
      // Return immediately so the service durably saves identity before another
      // provider write. An expired intent may recover a draft, never a payment.
      return { invoiceId: created.id }
    },
    async populateInvoice(input) {
      const operation = quoted(input.operation)
      requireFact(operation.invoice_id !== null && ['invoice_created', 'void_requested'].includes(operation.stage), 'invoice_intent_missing')
      const id = operation.invoice_id
      for (const line of operation.quote.lines) {
        const cleanup = operation.stage === 'void_requested'
        if (cleanup) {
          requireFact(!unexpired(operation), 'cleanup_not_expired')
          await accountIdentity(operation)
        } else {
          const fresh = await current(operation)
          requireFact(!fresh.targetApplied, 'unpaid_target_change')
        }
        const invoice = await readInvoice(operation, id, true)
        requireFact(invoice.status === 'draft' && invoice.amount_paid === 0 && invoice.payments.data.length === 0, 'incomplete_evidence')
        if (invoice.lines.data.some(actual => matchingLine(actual, line, operation))) continue
        requireFact(await guard(input), 'lost_claim')
        requireFact(cleanup ? Date.now() < Date.parse(operation.quote.quotedAt) + 23 * 60 * 60 * 1000
          : Date.now() < Date.parse(operation.paid_through), cleanup ? 'idempotency_window_elapsed' : 'renewal_boundary_crossed')
        await port.invoiceItems.create({ invoice: id, customer: operation.source_binding.stripe_customer_id,
          subscription: operation.source_binding.stripe_subscription_id, currency: operation.quote.currency,
          amount: line.amount, discountable: false, discounts: [], tax_rates: [],
          period: { start: Date.parse(line.periodStart) / 1000, end: Date.parse(line.periodEnd) / 1000 },
        }, { idempotencyKey: `pika-upgrade-${operation.operation_id}-invoice:${line.kind}` })
      }
      await readInvoice(operation, id)
    },
    async finalizeInvoice(input) {
      const operation = quoted(input.operation)
      if (!unexpired(operation)) return
      const evidence = await readEvidence(operation)
      if (evidence.kind !== 'unpaid' || evidence.status !== 'draft' || !await guard(input) || !unexpired(operation)) return
      await port.invoices.finalizeInvoice(evidence.invoiceId, { auto_advance: false }, { idempotencyKey: input.idempotencyKey })
    },
    async payInvoice(input) {
      const operation = quoted(input.operation)
      if (!operation.confirmed || !unexpired(operation)) return
      const evidence = await readEvidence(operation)
      if (evidence.kind !== 'unpaid' || evidence.status !== 'open') return
      await verifySourcePayment(operation)
      if (!unexpired(operation) || !await guard(input) || !unexpired(operation)) return
      try {
        await port.invoices.pay(evidence.invoiceId, { off_session: true, paid_out_of_band: false }, { idempotencyKey: input.idempotencyKey })
      } catch (error) {
        // A definite declined payment is an exception requiring recovery UX;
        // only uncertain transport errors retain the original request for replay.
        if (error instanceof Stripe.errors.StripeCardError) throw new UpgradeProviderContractError('payment_declined')
        throw error
      }
    },
    async applyTarget(input) {
      const operation = quoted(input.operation)
      if (!operation.confirmed) return
      const evidence = await readEvidence(operation)
      if (evidence.kind !== 'paid' || evidence.targetApplied || !await guard(input) || Date.now() >= Date.parse(operation.paid_through)) return
      await port.subscriptions.update(operation.source_binding.stripe_subscription_id, {
        items: [{ id: operation.quote.subscriptionItemId, price: operation.target.stripe_price_id, quantity: 1 }],
        proration_behavior: 'none', billing_cycle_anchor: 'unchanged',
      }, { idempotencyKey: input.idempotencyKey })
    },
    async voidInvoice(input) {
      const operation = quoted(input.operation)
      if (unexpired(operation)) return
      let evidence = await readEvidence(operation)
      if (evidence.kind !== 'unpaid') return
      if (evidence.status === 'draft') {
        // Recover only known, exact draft lines before non-collecting finalization.
        // A partial negative draft must never be finalized as a customer credit.
        await provider.populateInvoice(input)
        evidence = await readEvidence(operation)
        if (evidence.kind !== 'unpaid' || evidence.status !== 'draft' || !await guard(input)) return
        await port.invoices.finalizeInvoice(evidence.invoiceId, { auto_advance: false }, { idempotencyKey: `${input.idempotencyKey}:finalize` })
        evidence = await readEvidence(operation)
      }
      if (evidence.kind !== 'unpaid' || evidence.status !== 'open' || !await guard(input)) return
      await port.invoices.voidInvoice(evidence.invoiceId, {}, { idempotencyKey: input.idempotencyKey })
    },
  }
  return provider
}
