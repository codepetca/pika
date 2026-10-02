import { z } from 'zod'
import { BillingProviderSubscriptionSnapshotSchema, BillingSubscriptionBindingSchema } from './contracts'
import type { RenewalCloseoutEvidence, RenewalCloseoutProvider, RenewalCloseoutReadRequest } from './closeout-contracts'
import { createStripeBillingProvider, type StripeBillingReadPort } from './stripe-provider'
import { verifyPaidSubscriptionSnapshot } from './synchronize'
import { BILLING_RENEWAL_GRACE_SECONDS } from './lifecycle-policy'

type InvoiceStatus = 'draft' | 'open' | 'uncollectible'
type PostOptions = { idempotencyKey: string }
/** Runtime supplies the official pinned SDK; this adapter never constructs clients or opens gates. */
export type StripeCloseoutPort = Omit<StripeBillingReadPort, 'subscriptions' | 'invoices'> & {
  subscriptions: StripeBillingReadPort['subscriptions'] & {
    cancel(id: string, input: { invoice_now: false; prorate: false }): Promise<unknown>
  }
  invoices: StripeBillingReadPort['invoices'] & {
    list(input: { subscription: string; status: InvoiceStatus; limit: 1 }): Promise<unknown>
    update(id: string, input: { auto_advance: false }, options: PostOptions): Promise<unknown>
    voidInvoice(id: string, input: Record<string, never>, options: PostOptions): Promise<unknown>
  }
}

const reference = z.union([z.string().min(1), z.object({ id: z.string().min(1) })])
  .transform(value => typeof value === 'string' ? value : value.id)
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const invoiceFacts = z.object({
  auto_advance: z.boolean(), amount_remaining: money,
  amount_paid_off_stripe: money.optional(),
  payments: z.object({ has_more: z.literal(false), data: z.array(z.object({
    invoice: reference, livemode: z.literal(false), currency: z.string(),
    status: z.enum(['open', 'paid', 'canceled']), amount_paid: money.nullable(), amount_requested: money,
    payment: z.object({ type: z.literal('payment_intent'), payment_intent: reference }),
  })).max(100) }),
})
const intentFacts = z.object({
  id: z.string(), livemode: z.literal(false), customer: reference, currency: z.string(),
  amount: money, amount_received: money, amount_capturable: money,
  status: z.enum(['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'canceled', 'succeeded']),
  latest_charge: reference.nullable(), payment_method_types: z.array(z.string()).min(1).max(100),
})
const chargeFacts = z.object({
  id: z.string(), livemode: z.literal(false), customer: reference, currency: z.string(),
  payment_intent: reference, amount: money, amount_captured: money, status: z.enum(['failed', 'pending', 'succeeded']),
  paid: z.boolean(), captured: z.boolean(), refunded: z.boolean(), amount_refunded: money,
  disputed: z.boolean(), payment_method_details: z.object({ type: z.string() }),
})
const obligationList = z.object({ object: z.literal('list'), has_more: z.literal(false), data: z.array(z.object({
  id: z.string(), status: z.enum(['draft', 'open', 'uncollectible']), livemode: z.literal(false),
  customer: reference, parent: z.object({ subscription_details: z.object({ subscription: reference }) }),
})).max(1) })
const date = z.string().datetime({ offset: true })
const readRequest = z.object({ binding: BillingSubscriptionBindingSchema, invoiceId: z.string().min(1).max(255), paidThrough: date, cutoff: date })
const guardedRequest = readRequest.extend({ beforeMutation: z.custom<() => Promise<boolean>>(value => typeof value === 'function') })
const postRequest = guardedRequest.extend({ idempotencyKey: z.string().min(1).max(255) })
function attention(reason: Extract<RenewalCloseoutEvidence, { kind: 'attention' }>['reason']): RenewalCloseoutEvidence {
  return { kind: 'attention', reason }
}
function equalTimestamp(a: string, b: string): boolean { return Date.parse(a) === Date.parse(b) }

/**
 * Reuses the canonical invoice/paid snapshot validation, while retaining raw
 * InvoicePayments and retrieving every unpaid intent it would otherwise omit.
 * Each call owns its own observation; previous reads never authorize a write.
 */
export function createStripeCloseoutProvider(sdk: StripeCloseoutPort): RenewalCloseoutProvider & {
  readCloseoutEvidence(input: RenewalCloseoutReadRequest): Promise<RenewalCloseoutEvidence>
} {
  async function readCloseoutEvidence(input: RenewalCloseoutReadRequest): Promise<RenewalCloseoutEvidence> {
    const parsedRequest = readRequest.safeParse(input)
    if (!parsedRequest.success) return attention('identity_mismatch')
    const { binding, invoiceId, paidThrough, cutoff } = parsedRequest.data
    if (Date.parse(cutoff) !== Date.parse(paidThrough) + BILLING_RENEWAL_GRACE_SECONDS * 1000) return attention('incomplete_evidence')
    let rawInvoice: unknown
    const intents = new Map<string, unknown>()
    const charges = new Map<string, unknown>()
    const current = createStripeBillingProvider({
      accounts: sdk.accounts, subscriptions: sdk.subscriptions,
      invoices: {
        retrieve: async id => { rawInvoice = await sdk.invoices.retrieve(id); return rawInvoice },
        list: input => sdk.invoices.list(input),
      },
      paymentIntents: { retrieve: async id => { const raw = await sdk.paymentIntents.retrieve(id); intents.set(id, raw); return raw } },
      charges: { retrieve: async id => { const raw = await sdk.charges.retrieve(id); charges.set(id, raw); return raw } },
    })
    const candidate = BillingProviderSubscriptionSnapshotSchema.safeParse(await current.retrieveSubscription(binding))
    if (!candidate.success) return attention('incomplete_evidence')
    const snapshot = candidate.data
    const invoice = snapshot.latestInvoice
    const item = snapshot.items[0]
    if (!invoice || invoice.id !== invoiceId) return attention('unknown_invoice')
    if (snapshot.stripeAccount !== binding.stripe_account || snapshot.liveMode
      || snapshot.subscriptionId !== binding.stripe_subscription_id || snapshot.customerId !== binding.stripe_customer_id
      || snapshot.items.length !== 1 || item.quantity !== 1 || item.priceLiveMode
      || item.priceId !== binding.stripe_price_id || item.productId !== binding.stripe_product_id
      || item.unitAmount !== binding.unit_amount || item.currency !== binding.currency
      || item.interval !== binding.interval || item.intervalCount !== 1
      || invoice.customerId !== binding.stripe_customer_id || invoice.subscriptionId !== binding.stripe_subscription_id
      || invoice.currency !== binding.currency) return attention('identity_mismatch')
    if (!['active', 'past_due', 'unpaid', 'canceled'].includes(snapshot.status)
      || snapshot.pendingUpdate || snapshot.pauseCollection || snapshot.scheduleId !== null) return attention('incomplete_evidence')
    const line = invoice.lines[0]
    if (binding.unit_amount <= 0 || invoice.billingReason !== 'subscription_cycle'
      || invoice.subtotal !== binding.unit_amount || invoice.total !== binding.unit_amount || invoice.amountDue !== binding.unit_amount
      || invoice.startingBalance !== 0 || invoice.endingBalance !== 0 || invoice.hasDiscounts || invoice.hasTaxes
      || invoice.totalDiscountAmount !== 0 || invoice.totalTaxAmount !== 0
      || invoice.prePaymentCreditNotesAmount !== 0 || invoice.postPaymentCreditNotesAmount !== 0
      || invoice.lines.length !== 1 || line.subscriptionId !== binding.stripe_subscription_id || line.priceId !== binding.stripe_price_id
      || line.quantity !== 1 || line.proration || line.amount !== binding.unit_amount || line.hasDiscounts || line.hasTaxes
      || !equalTimestamp(line.periodStart, paidThrough) || !equalTimestamp(line.periodStart, item.currentPeriodStart)
      || !equalTimestamp(line.periodEnd, item.currentPeriodEnd) || Date.parse(line.periodEnd) <= Date.parse(line.periodStart)) return attention('unexpected_money')
    const raw = invoiceFacts.safeParse(rawInvoice)
    if (!raw.success) return attention('incomplete_evidence')
    if ((raw.data.amount_paid_off_stripe ?? 0) !== 0) return attention('unsupported_payment')
    let pending = false
    for (const payment of raw.data.payments.data) {
      if (payment.invoice !== invoiceId || payment.currency !== binding.currency || payment.amount_requested !== binding.unit_amount) return attention('identity_mismatch')
      const id = payment.payment.payment_intent
      const parsedIntent = intentFacts.safeParse(intents.has(id) ? intents.get(id) : await sdk.paymentIntents.retrieve(id))
      if (!parsedIntent.success) return attention('incomplete_evidence')
      const intent = parsedIntent.data
      if (intent.id !== id || intent.customer !== binding.stripe_customer_id || intent.currency !== binding.currency || intent.amount !== binding.unit_amount) return attention('identity_mismatch')
      if (intent.payment_method_types.length !== 1 || intent.payment_method_types[0] !== 'card') return attention('unsupported_payment')
      if (intent.latest_charge) {
        const parsedCharge = chargeFacts.safeParse(charges.has(intent.latest_charge) ? charges.get(intent.latest_charge) : await sdk.charges.retrieve(intent.latest_charge))
        if (!parsedCharge.success) return attention('incomplete_evidence')
        const charge = parsedCharge.data
        if (charge.id !== intent.latest_charge || charge.customer !== binding.stripe_customer_id
          || charge.currency !== binding.currency || charge.payment_intent !== id || charge.amount !== binding.unit_amount) return attention('identity_mismatch')
        if (charge.disputed || charge.refunded || charge.amount_refunded !== 0) return attention('unexpected_money')
        if (charge.payment_method_details.type !== 'card') return attention('unsupported_payment')
        if (charge.amount_captured !== (invoice.status === 'paid' ? binding.unit_amount : 0)) return attention('unexpected_money')
        if (invoice.status !== 'paid' && (charge.status !== 'failed' || charge.paid || charge.captured)) pending = true
      }
      if (invoice.status === 'paid' && intent.amount_capturable !== 0) return attention('unexpected_money')
      if (invoice.status === 'void' && intent.status === 'requires_payment_method') return attention('incomplete_evidence')
      if (invoice.status !== 'paid') {
        if ((payment.amount_paid ?? 0) !== 0 || (intent.amount_received > 0 && intent.amount_received !== binding.unit_amount)) return attention('partial_payment')
        if (payment.status === 'paid' || intent.amount_received !== 0 || intent.amount_capturable !== 0
          || !['requires_payment_method', 'canceled'].includes(intent.status)) pending = true
      }
    }
    if (invoice.status === 'paid') {
      if (!['active', 'canceled'].includes(snapshot.status)) return attention('incomplete_evidence')
      const proof = verifyPaidSubscriptionSnapshot(binding, { ...snapshot, status: 'active', cancelAt: null, cancelAtPeriodEnd: false })
      if (typeof proof === 'string' || (snapshot.cancelAt !== null && !equalTimestamp(snapshot.cancelAt, proof.periodEnd))) return attention('unsupported_payment')
      return { kind: 'paid', ...proof, providerStatus: snapshot.status as 'active' | 'canceled',
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd || snapshot.status === 'canceled', terminalObligationsCleared: snapshot.terminalObligationsCleared === true }
    }
    if (invoice.amountPaid !== 0) return attention('partial_payment')
    if (pending) return { kind: 'payment_pending', invoiceId }
    if (!['open', 'uncollectible', 'void'].includes(invoice.status)
      || (snapshot.cancelAt !== null && !equalTimestamp(snapshot.cancelAt, paidThrough))) return attention('incomplete_evidence')
    if (raw.data.amount_remaining !== (invoice.status === 'void' ? 0 : binding.unit_amount)) return attention('unexpected_money')
    // limit:1 is sufficient only when has_more=false and the sole row is the
    // fully read target. Any other obligation or incomplete list stops closeout.
    for (const status of ['draft', 'open', 'uncollectible'] as const) {
      const list = obligationList.safeParse(await sdk.invoices.list({ subscription: binding.stripe_subscription_id, status, limit: 1 }))
      if (!list.success) return attention('incomplete_evidence')
      for (const other of list.data.data) {
        if (other.id !== invoiceId || invoice.status === 'void') return attention('unknown_invoice')
        if (other.status !== status || status !== invoice.status || other.customer !== binding.stripe_customer_id
          || other.parent.subscription_details.subscription !== binding.stripe_subscription_id) return attention('identity_mismatch')
      }
    }
    if (invoice.status === 'void') return { kind: 'invoice_voided', invoiceId, subscriptionCanceled: snapshot.status === 'canceled', obligationsCleared: true }
    return { kind: 'unpaid', invoiceId, invoiceStatus: invoice.status as 'open' | 'uncollectible', collectionPaused: !raw.data.auto_advance }
  }
  return {
    readCloseoutEvidence,
    async pauseInvoiceCollection(input) {
      const parsed = postRequest.safeParse(input)
      if (!parsed.success) return
      const target = parsed.data
      const evidence = await readCloseoutEvidence(target)
      if (evidence.kind !== 'unpaid' || evidence.collectionPaused) return
      if (await target.beforeMutation() !== true) return
      await sdk.invoices.update(target.invoiceId, { auto_advance: false }, { idempotencyKey: target.idempotencyKey })
    },
    async voidInvoice(input) {
      const parsed = postRequest.safeParse(input)
      if (!parsed.success) return
      const target = parsed.data
      const evidence = await readCloseoutEvidence(target)
      if (evidence.kind !== 'unpaid' || !evidence.collectionPaused) return
      if (await target.beforeMutation() !== true) return
      await sdk.invoices.voidInvoice(target.invoiceId, {}, { idempotencyKey: target.idempotencyKey })
    },
    async cancelSubscription(input) {
      const parsed = guardedRequest.safeParse(input)
      if (!parsed.success) return
      const target = parsed.data
      const evidence = await readCloseoutEvidence(target)
      if (evidence.kind !== 'invoice_voided' || !evidence.obligationsCleared || evidence.subscriptionCanceled) return
      if (await target.beforeMutation() !== true) return
      // DELETE has no Stripe idempotency guarantee. An ambiguous failure must be
      // reconciled by a new subscription read before another cancel attempt.
      await sdk.subscriptions.cancel(target.binding.stripe_subscription_id, { invoice_now: false, prorate: false })
    },
  }
}
