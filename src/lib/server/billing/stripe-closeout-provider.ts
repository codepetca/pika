import { z } from 'zod'
import { BillingProviderSubscriptionSnapshotSchema, BillingSubscriptionBindingSchema, type BillingProviderSubscriptionSnapshot } from './contracts'
import { RenewalCloseoutScheduleSchema, type RenewalCloseoutEvidence, type RenewalCloseoutProvider, type RenewalCloseoutReadRequest, type RenewalCloseoutSchedule } from './closeout-contracts'
import { createStripeBillingProvider, type StripeBillingReadPort } from './stripe-provider'
import { verifyPaidSubscriptionSnapshot } from './synchronize'
import { BILLING_RENEWAL_GRACE_SECONDS } from './lifecycle-policy'
import { scheduledTermEnd } from './scheduled-plan-change-period'

type InvoiceStatus = 'draft' | 'open' | 'uncollectible'
type PostOptions = { idempotencyKey: string }
/** Runtime supplies the official pinned SDK; this adapter never constructs clients or opens gates. */
export type StripeCloseoutPort = Omit<StripeBillingReadPort, 'subscriptions' | 'invoices'> & {
  retrieveSchedule?(id: string): Promise<unknown>
  cancelSchedule?(id: string, input: { invoice_now: false; prorate: false }, options: PostOptions): Promise<unknown>
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
const phaseBounds = z.object({ start_date: z.number().int().positive(), end_date: z.number().int().positive() })
const stripeSchedule = z.object({
  id: z.string(), object: z.literal('subscription_schedule'), livemode: z.literal(false),
  customer: reference, subscription: reference.nullable(), status: z.enum(['active', 'canceled']),
  metadata: z.object({ pika_plan_change_operation: z.string().uuid() }).strict(),
  end_behavior: z.literal('release'), canceled_at: z.number().int().positive().nullable(),
  released_at: z.null().optional(), released_subscription: z.null().optional(), completed_at: z.null().optional(),
  current_phase: phaseBounds.nullable(),
  phases: z.array(phaseBounds.extend({
    currency: z.string(), proration_behavior: z.string(),
    items: z.array(z.object({ price: reference, quantity: z.number().int() })).max(100),
  })).max(100).optional(),
})
const readRequest = z.object({
  binding: BillingSubscriptionBindingSchema, invoiceId: z.string().min(1).max(255),
  paidThrough: date, cutoff: date, scheduled: RenewalCloseoutScheduleSchema.optional(),
})
const guardedRequest = readRequest.extend({ beforeMutation: z.custom<() => Promise<boolean>>(value => typeof value === 'function') })
const postRequest = guardedRequest.extend({ idempotencyKey: z.string().min(1).max(255) })
const cancelRequest = guardedRequest.extend({ idempotencyKey: z.string().min(1).max(255).optional() })
function attention(reason: Extract<RenewalCloseoutEvidence, { kind: 'attention' }>['reason']): RenewalCloseoutEvidence {
  return { kind: 'attention', reason }
}
function equalTimestamp(a: string, b: string): boolean { return Date.parse(a) === Date.parse(b) }

function matchesTargetItem(scheduled: RenewalCloseoutSchedule, snapshot: BillingProviderSubscriptionSnapshot): boolean {
  const binding = scheduled.target_binding
  const item = snapshot.items[0]
  return snapshot.isCurrent && !snapshot.liveMode && snapshot.stripeAccount === binding.stripe_account
    && snapshot.subscriptionId === binding.stripe_subscription_id && snapshot.customerId === binding.stripe_customer_id
    && snapshot.items.length === 1 && item.quantity === 1 && !item.priceLiveMode
    && item.priceId === binding.stripe_price_id && item.productId === binding.stripe_product_id
    && item.unitAmount === binding.unit_amount && item.currency === binding.currency
    && item.interval === binding.interval && item.intervalCount === 1
    && equalTimestamp(item.currentPeriodStart, scheduled.effective_at)
    && Date.parse(item.currentPeriodEnd) === scheduledTermEnd(scheduled.effective_at, binding.interval)
}

async function readInstalledSchedule(retrieveSchedule: (id: string) => Promise<unknown>, scheduled: RenewalCloseoutSchedule) {
  const observed = stripeSchedule.safeParse(await retrieveSchedule(scheduled.provider_schedule_id))
  if (!observed.success) return null
  const schedule = observed.data
  return schedule.id === scheduled.provider_schedule_id && schedule.customer === scheduled.target_binding.stripe_customer_id
    && schedule.metadata.pika_plan_change_operation === scheduled.operation_id ? schedule : null
}

function matchesTargetPhase(schedule: z.infer<typeof stripeSchedule>, scheduled: RenewalCloseoutSchedule): boolean {
  const binding = scheduled.target_binding
  const start = Date.parse(scheduled.effective_at)
  const end = scheduledTermEnd(scheduled.effective_at, binding.interval)
  const phases = schedule.phases?.filter(phase => phase.start_date * 1000 === start)
  return phases?.length === 1 && phases[0].end_date * 1000 === end && phases[0].currency === binding.currency
    && phases[0].proration_behavior === 'none' && phases[0].items.length === 1
    && phases[0].items[0].price === binding.stripe_price_id && phases[0].items[0].quantity === 1
}

/** A schedule-caused invoice still needs the ordinary financial and payment proof. */
export async function verifyInstalledStripeSchedule(
  retrieveSchedule: (id: string) => Promise<unknown>,
  scheduled: RenewalCloseoutSchedule,
  snapshot: BillingProviderSubscriptionSnapshot,
): Promise<boolean> {
  if (snapshot.scheduleId !== scheduled.provider_schedule_id || !['active', 'past_due', 'unpaid'].includes(snapshot.status)
    || snapshot.cancelAt !== null || snapshot.cancelAtPeriodEnd || snapshot.pauseCollection || snapshot.pendingUpdate
    || !matchesTargetItem(scheduled, snapshot)) return false
  const schedule = await readInstalledSchedule(retrieveSchedule, scheduled)
  if (!schedule || schedule.status !== 'active' || schedule.canceled_at !== null || !schedule.current_phase
    || schedule.subscription !== scheduled.target_binding.stripe_subscription_id
    || schedule.current_phase.start_date * 1000 !== Date.parse(scheduled.effective_at)
    || schedule.current_phase.end_date * 1000 !== scheduledTermEnd(scheduled.effective_at, scheduled.target_binding.interval)) return false
  return matchesTargetPhase(schedule, scheduled)
}

/**
 * Reuses the canonical invoice/paid snapshot validation, while retaining raw
 * InvoicePayments and retrieving every unpaid intent it would otherwise omit.
 * Each call owns its own observation; previous reads never authorize a write.
 */
export function createStripeCloseoutProvider(sdk: StripeCloseoutPort): Omit<RenewalCloseoutProvider, 'readCloseoutEvidence'> & {
  readCloseoutEvidence(input: RenewalCloseoutReadRequest): Promise<RenewalCloseoutEvidence>
} {
  async function readCloseoutEvidence(input: RenewalCloseoutReadRequest): Promise<RenewalCloseoutEvidence> {
    const parsedRequest = readRequest.safeParse(input)
    if (!parsedRequest.success) return attention('identity_mismatch')
    const { binding: paidBinding, invoiceId, paidThrough, cutoff, scheduled } = parsedRequest.data
    const binding = scheduled?.target_binding ?? paidBinding
    const scheduledEnd = scheduled ? scheduledTermEnd(paidThrough, binding.interval) : null
    if (Date.parse(cutoff) !== Date.parse(paidThrough) + BILLING_RENEWAL_GRACE_SECONDS * 1000) return attention('incomplete_evidence')
    if (scheduled && (!equalTimestamp(scheduled.effective_at, paidThrough)
      || binding.subscription_id !== paidBinding.subscription_id || binding.subject_user_id !== paidBinding.subject_user_id
      || binding.stripe_account !== paidBinding.stripe_account || binding.provider_mode !== paidBinding.provider_mode
      || binding.stripe_customer_id !== paidBinding.stripe_customer_id || binding.stripe_subscription_id !== paidBinding.stripe_subscription_id
      || binding.offering_version_id === paidBinding.offering_version_id || binding.stripe_price_id === paidBinding.stripe_price_id
      || paidBinding.plan_key !== 'pro' || binding.plan_key !== 'plus' || binding.unit_amount >= paidBinding.unit_amount
      || binding.currency !== paidBinding.currency || binding.interval !== paidBinding.interval)) return attention('identity_mismatch')
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
    const candidate = BillingProviderSubscriptionSnapshotSchema.safeParse(await current.retrieveSubscription(paidBinding))
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
      || snapshot.pendingUpdate || snapshot.pauseCollection) return attention('incomplete_evidence')
    const scheduledUpdate = scheduled !== undefined && invoice.billingReason === 'subscription_update'
    const terminalScheduledVoid = scheduled !== undefined && snapshot.status === 'canceled' && invoice.status === 'void'
    if (scheduled) {
      const canceled = snapshot.status === 'canceled'
      const expectedId = scheduled.provider_schedule_id
      const retrieveSchedule = sdk.retrieveSchedule?.bind(sdk)
      if (!retrieveSchedule) return attention('incomplete_evidence')
      if (canceled) {
        // Stripe can clear both pointers on cancellation. The exact saved
        // schedule and operation marker independently establish correlation.
        if ((snapshot.scheduleId !== null && snapshot.scheduleId !== expectedId)
          || (!terminalScheduledVoid && (snapshot.cancelAt !== null || snapshot.cancelAtPeriodEnd))) return attention('incomplete_evidence')
        const schedule = await readInstalledSchedule(retrieveSchedule, scheduled)
        if (!schedule || schedule.status !== 'canceled' || schedule.canceled_at === null || schedule.current_phase !== null
          || (scheduledUpdate && !matchesTargetPhase(schedule, scheduled))
          || (schedule.subscription !== null && schedule.subscription !== binding.stripe_subscription_id)) return attention('incomplete_evidence')
      } else if (!await verifyInstalledStripeSchedule(retrieveSchedule, scheduled, snapshot)) return attention('incomplete_evidence')
    } else if (snapshot.scheduleId !== null) return attention('incomplete_evidence')
    const line = invoice.lines[0]
    if (binding.unit_amount <= 0 || (invoice.billingReason !== 'subscription_cycle' && !scheduledUpdate)
      || invoice.subtotal !== binding.unit_amount || invoice.total !== binding.unit_amount || invoice.amountDue !== binding.unit_amount
      || invoice.startingBalance !== 0 || invoice.endingBalance !== 0 || invoice.hasDiscounts || invoice.hasTaxes
      || invoice.totalDiscountAmount !== 0 || invoice.totalTaxAmount !== 0
      || invoice.prePaymentCreditNotesAmount !== 0 || invoice.postPaymentCreditNotesAmount !== 0
      || invoice.lines.length !== 1 || line.subscriptionId !== binding.stripe_subscription_id || line.priceId !== binding.stripe_price_id
      || line.quantity !== 1 || line.proration || line.amount !== binding.unit_amount || line.hasDiscounts || line.hasTaxes
      || !equalTimestamp(line.periodStart, paidThrough) || !equalTimestamp(line.periodStart, item.currentPeriodStart)
      || (scheduledEnd !== null && Date.parse(line.periodEnd) !== scheduledEnd)
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
      if (!['active', 'canceled'].includes(snapshot.status) || (scheduled && snapshot.status !== 'active')) return attention('incomplete_evidence')
      const proof = verifyPaidSubscriptionSnapshot(binding, {
        ...snapshot, status: 'active', cancelAt: null, cancelAtPeriodEnd: false, scheduleId: null,
        latestInvoice: scheduledUpdate ? { ...invoice, billingReason: 'subscription_cycle' } : invoice,
      })
      if (typeof proof === 'string' || (snapshot.cancelAt !== null && !equalTimestamp(snapshot.cancelAt, proof.periodEnd))) return attention('unsupported_payment')
      return { kind: 'paid', ...proof, providerStatus: snapshot.status as 'active' | 'canceled',
        cancelAtPeriodEnd: snapshot.cancelAtPeriodEnd || snapshot.status === 'canceled', terminalObligationsCleared: snapshot.terminalObligationsCleared === true }
    }
    if (invoice.amountPaid !== 0) return attention('partial_payment')
    if (pending) return { kind: 'payment_pending', invoiceId }
    if (!['open', 'uncollectible', 'void'].includes(invoice.status)
      || (!terminalScheduledVoid && snapshot.cancelAt !== null && !equalTimestamp(snapshot.cancelAt, paidThrough))) return attention('incomplete_evidence')
    // Stripe can retain the original due amount on a void invoice. The canceled
    // payment evidence above and the obligations list below decide collectability.
    if (raw.data.amount_remaining !== binding.unit_amount
      && (invoice.status !== 'void' || raw.data.amount_remaining !== 0)) return attention('unexpected_money')
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
      const parsed = cancelRequest.safeParse(input)
      if (!parsed.success) return
      const target = parsed.data
      const evidence = await readCloseoutEvidence(target)
      if (evidence.kind !== 'invoice_voided' || !evidence.obligationsCleared || evidence.subscriptionCanceled) return
      if (target.scheduled) {
        if (!sdk.cancelSchedule || !target.idempotencyKey || await target.beforeMutation() !== true) return
        await sdk.cancelSchedule(target.scheduled.provider_schedule_id, { invoice_now: false, prorate: false },
          { idempotencyKey: target.idempotencyKey })
        return
      }
      if (await target.beforeMutation() !== true) return
      // DELETE has no Stripe idempotency guarantee. An ambiguous failure must be
      // reconciled by a new subscription read before another cancel attempt.
      await sdk.subscriptions.cancel(target.binding.stripe_subscription_id, { invoice_now: false, prorate: false })
    },
  }
}
