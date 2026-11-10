import type Stripe from 'stripe'
import { z } from 'zod'
import { BillingReconciliationScopeSchema, type BillingReconciliationScope } from './contracts'
import { scheduledTermEnd } from './scheduled-plan-change-period'

const providerId = (prefix: string) => z.string().regex(new RegExp('^' + prefix + '[A-Za-z0-9]+$'))
const accountId = providerId('acct_')
const customerId = providerId('cus_')
const subscriptionId = providerId('sub_')
const scheduleId = providerId('sub_sched_')
const priceId = providerId('price_')
const productId = providerId('prod_')
const paymentMethodId = providerId('pm_')
const timestamp = z.number().int().positive().max(8_640_000_000_000)
const time = z.iso.datetime({ offset: true })
const currency = z.enum(['cad', 'usd'])
const interval = z.enum(['month', 'year'])
const emptyList = z.array(z.unknown()).length(0).nullish()
const emptyMetadata = z.record(z.string(), z.never()).nullish()
const automaticTaxOff = z.object({ enabled: z.literal(false), liability: z.null().optional() })
const automaticCollection = z.literal('charge_automatically')
const paymentMethod = paymentMethodId.nullish()

const termsSchema = z.strictObject({
  priceId, productId, currency, interval, unitAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
})
export const stripePlanChangeOperationSchema = z.strictObject({
  operationId: z.uuid(),
  stripeAccount: accountId,
  stripeCustomerId: customerId,
  stripeSubscriptionId: subscriptionId,
  source: termsSchema,
  target: termsSchema,
  paidPeriodStart: time,
  effectiveAt: time,
  scheduleId: scheduleId.optional(),
  providerMode: z.literal('live').optional(),
  lastPaidInvoiceId: providerId('in_').optional(),
})
export type StripePlanChangeOperation = z.infer<typeof stripePlanChangeOperationSchema>
type PersistedSchedule = StripePlanChangeOperation & { scheduleId: string }
type ScheduleMutation<Operation> = {
  operation: Operation
  idempotencyKey: string
  /** Persist once, at most 23 hours after the first possible provider write. */
  replayUntil: string
  beforeMutation(): Promise<boolean>
}

export type StripePlanChangePort = {
  retrieveAccount(): Promise<unknown>
  retrieveSubscription(id: string): Promise<unknown>
  retrievePrice(id: string): Promise<unknown>
  retrieveSchedule(id: string): Promise<unknown>
  listCreationEvents(created: number): Promise<unknown>
  attachSchedule(input: Stripe.SubscriptionScheduleCreateParams, options: Stripe.RequestOptions): Promise<unknown>
  updateSchedule(id: string, input: Stripe.SubscriptionScheduleUpdateParams, options: Stripe.RequestOptions): Promise<unknown>
}

export function createStripePlanChangePort(stripe: Stripe): StripePlanChangePort {
  return {
    retrieveAccount: () => stripe.accounts.retrieve(null),
    retrieveSubscription: id => stripe.subscriptions.retrieve(id, { expand: ['customer', 'latest_invoice'] }),
    retrievePrice: id => stripe.prices.retrieve(id),
    retrieveSchedule: id => stripe.subscriptionSchedules.retrieve(id),
    listCreationEvents: created => stripe.events.list({
      type: 'subscription_schedule.created', created: { gte: created - 1, lte: created + 1 }, limit: 100,
    }),
    attachSchedule: (input, options) => stripe.subscriptionSchedules.create(input, options),
    updateSchedule: (id, input, options) => stripe.subscriptionSchedules.update(id, input, options),
  }
}

const unsupportedBillingSettings = {
  application_fee_percent: z.null().optional(),
  billing_thresholds: z.null().optional(),
  on_behalf_of: z.null().optional(),
  transfer_data: z.null().optional(),
}
const priceSchema = z.object({
  id: priceId, product: productId, livemode: z.boolean(), active: z.boolean(),
  type: z.literal('recurring'), billing_scheme: z.literal('per_unit'), custom_unit_amount: z.null().optional(),
  transform_quantity: z.null().optional(), currency, unit_amount: z.number().int().positive(),
  recurring: z.object({ interval, interval_count: z.literal(1), usage_type: z.literal('licensed') }),
})
const subscriptionSchema = z.object({
  id: subscriptionId, object: z.literal('subscription'), livemode: z.boolean(),
  customer: z.object({ id: customerId, object: z.literal('customer'), livemode: z.boolean(),
    deleted: z.literal(false).optional(), discount: z.null().optional() }),
  customer_account: z.null().optional(), schedule: scheduleId.nullable(),
  status: z.enum(['active', 'past_due', 'unpaid']), currency, collection_method: automaticCollection,
  automatic_tax: automaticTaxOff, default_tax_rates: emptyList, discounts: emptyList,
  cancel_at: z.null(), cancel_at_period_end: z.literal(false), canceled_at: z.null().optional(),
  pause_collection: z.null(), pending_update: z.null(), pending_invoice_item_interval: z.null().optional(),
  default_payment_method: paymentMethod, default_source: z.null().optional(),
  ...unsupportedBillingSettings,
  latest_invoice: z.object({
    id: providerId('in_').optional(), status: z.string().nullable(), livemode: z.boolean(), customer: customerId,
    amount_remaining: z.number().int().nonnegative(), paid_out_of_band: z.literal(false).optional(),
    amount_paid_off_stripe: z.literal(0).optional(),
  }).nullable(),
  items: z.object({
    has_more: z.literal(false),
    data: z.tuple([z.object({
      price: priceSchema, quantity: z.literal(1), current_period_start: timestamp, current_period_end: timestamp,
      discounts: emptyList, tax_rates: emptyList, billing_thresholds: z.null().optional(),
    })]),
  }),
})
const phaseBounds = z.object({ start_date: timestamp, end_date: timestamp })
const issuer = z.object({ issuer: z.object({ type: z.literal('self') }).optional(),
  account_tax_ids: emptyList, days_until_due: z.null().optional() })
const phaseSchema = phaseBounds.extend({
  currency, items: z.tuple([z.object({
    price: priceId, quantity: z.literal(1), tax_rates: emptyList, discounts: emptyList,
    metadata: emptyMetadata, billing_thresholds: z.null().optional(),
  })]),
  proration_behavior: z.enum(['none', 'create_prorations']),
  billing_cycle_anchor: z.enum(['automatic', 'phase_start']).nullish(),
  collection_method: automaticCollection.nullish(),
  default_payment_method: paymentMethod, default_tax_rates: emptyList, discounts: emptyList,
  add_invoice_items: emptyList, metadata: emptyMetadata, automatic_tax: automaticTaxOff.optional(),
  trial_end: z.null().optional(), trial: z.literal(false).optional(),
  invoice_settings: issuer.nullish(), description: z.null().optional(),
  ...unsupportedBillingSettings,
})
const scheduleSchema = z.object({
  id: scheduleId, object: z.literal('subscription_schedule'), created: timestamp, livemode: z.boolean(),
  application: z.null().optional(), customer_account: z.null().optional(), customer: customerId,
  subscription: subscriptionId, status: z.literal('active'), end_behavior: z.literal('release'),
  canceled_at: z.null().optional(), completed_at: z.null().optional(), released_at: z.null().optional(),
  released_subscription: z.null().optional(), current_phase: phaseBounds,
  metadata: z.record(z.string(), z.string()).nullish(), phases: z.array(phaseSchema).min(1).max(2),
  default_settings: z.object({
    automatic_tax: automaticTaxOff.optional(), collection_method: automaticCollection.nullish(),
    billing_cycle_anchor: z.literal('automatic'), default_source: z.null().optional(),
    default_payment_method: paymentMethod, invoice_settings: issuer.nullish(),
    ...unsupportedBillingSettings,
  }),
  pause_schedules: emptyList, renewal_interval: z.null().optional(),
})
const eventsSchema = z.object({
  data: z.array(z.object({
    type: z.literal('subscription_schedule.created'), livemode: z.boolean(), created: timestamp,
    account: accountId.nullish(), context: z.null().optional(),
    request: z.object({ idempotency_key: z.string().nullable() }).nullable(),
    data: z.object({ object: z.object({
      id: scheduleId, object: z.literal('subscription_schedule'), livemode: z.boolean(),
      customer: customerId, subscription: subscriptionId.nullable(),
    }) }),
  })).max(100),
})
type Terms = z.infer<typeof termsSchema>
type ProviderPrice = z.infer<typeof priceSchema>
type Subscription = z.infer<typeof subscriptionSchema>
type Schedule = z.infer<typeof scheduleSchema>
type Phase = z.infer<typeof phaseSchema>
type ParsedOperation = ReturnType<typeof parseOperation>

export class StripePlanChangeContractError extends Error {
  constructor() {
    super('Stripe plan change evidence is invalid')
  }
}

export class StripePlanChangeCreationEvidencePending extends StripePlanChangeContractError {}

function requireFact(valid: boolean): asserts valid {
  if (!valid) throw new StripePlanChangeContractError()
}

function decode<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new StripePlanChangeContractError()
  return result.data
}

function parseOperation(candidate: StripePlanChangeOperation) {
  const operation = decode(stripePlanChangeOperationSchema, candidate)
  const starts = Date.parse(operation.paidPeriodStart) / 1000
  const effective = Date.parse(operation.effectiveAt) / 1000
  requireFact(timestamp.safeParse(starts).success && timestamp.safeParse(effective).success && starts < effective)
  requireFact(operation.source.priceId !== operation.target.priceId && operation.source.currency === operation.target.currency)
  const targetEnd = scheduledTermEnd(operation.effectiveAt, operation.target.interval) / 1000
  requireFact(timestamp.safeParse(targetEnd).success && targetEnd > effective)
  return { ...operation, starts, effective, targetEnd }
}

export function stripePlanChangeIdempotencyKey(operationId: string, action: 'attach' | 'configure') {
  return 'pika-plan-change-' + operationId + '-' + action
}

function sameTerms(price: ProviderPrice, terms: Terms) {
  return price.id === terms.priceId && price.product === terms.productId && price.currency === terms.currency
    && price.unit_amount === terms.unitAmount && price.recurring.interval === terms.interval
}

function matchesPhase(phase: Phase, terms: Terms, starts: number, ends: number) {
  return phase.start_date === starts && phase.end_date === ends && phase.items[0].price === terms.priceId
    && phase.currency === terms.currency
}

function operationMarker(operation: ParsedOperation) {
  return { pika_plan_change_operation: operation.operationId }
}

function configurationState(schedule: Schedule, operation: ParsedOperation, subscription: Subscription, now: number) {
  const [source, target] = schedule.phases
  requireFact(matchesPhase(source, operation.source, operation.starts, operation.effective))
  const active = now < operation.effective ? source : target
  requireFact(!!active && now >= active.start_date && now < active.end_date
    && schedule.current_phase.start_date === active.start_date && schedule.current_phase.end_date === active.end_date)
  requireFact((active.default_payment_method ?? schedule.default_settings.default_payment_method ?? null)
    === (subscription.default_payment_method ?? null))
  if (!target) {
    requireFact(Object.keys(schedule.metadata ?? {}).length === 0
      && (source.billing_cycle_anchor == null || source.billing_cycle_anchor === 'automatic'))
    return 'attached' as const
  }
  requireFact(Object.keys(schedule.metadata ?? {}).length === 1
    && schedule.metadata?.pika_plan_change_operation === operation.operationId
    && matchesPhase(target, operation.target, operation.effective, operation.targetEnd)
    && source.proration_behavior === 'none' && target.proration_behavior === 'none'
    && (source.billing_cycle_anchor == null || source.billing_cycle_anchor === 'automatic')
    && target.billing_cycle_anchor === 'phase_start'
    && (source.default_payment_method ?? null) === (target.default_payment_method ?? null))
  return 'configured' as const
}

export function createStripePlanChangeProvider(port: StripePlanChangePort, now = Date.now, configuredScope?: BillingReconciliationScope) {
  const scope = BillingReconciliationScopeSchema.optional().parse(configuredScope)
  const live = scope?.providerMode === 'live'
  function scopedOperation(candidate: StripePlanChangeOperation) {
    const operation = parseOperation(candidate)
    requireFact((!scope || operation.stripeAccount === scope.stripeAccount)
      && (live ? operation.providerMode === 'live' && operation.lastPaidInvoiceId !== undefined
        : operation.providerMode === undefined && operation.lastPaidInvoiceId === undefined))
    return operation
  }
  async function readPrice(terms: Terms, requireActive = false) {
    const price = decode(priceSchema, await port.retrievePrice(terms.priceId))
    requireFact(price.livemode === live && sameTerms(price, terms) && (!requireActive || price.active))
  }

  async function readSubscription(operation: ParsedOperation, at: number) {
    const account = decode(z.object({ id: accountId }), await port.retrieveAccount())
    requireFact(account.id === operation.stripeAccount)
    const subscription = decode(subscriptionSchema, await port.retrieveSubscription(operation.stripeSubscriptionId))
    const [item] = subscription.items.data
    const before = at < operation.effective
    const expected = before ? operation.source : operation.target
    requireFact(subscription.livemode === live && subscription.customer.livemode === live
      && item.price.livemode === live && (subscription.latest_invoice === null || subscription.latest_invoice.livemode === live)
      && subscription.id === operation.stripeSubscriptionId && subscription.customer.id === operation.stripeCustomerId
      && subscription.currency === expected.currency && sameTerms(item.price, expected)
      && item.current_period_start === (before ? operation.starts : operation.effective)
      && item.current_period_end === (before ? operation.effective : operation.targetEnd))
    if (before) {
      const invoice = subscription.latest_invoice
      requireFact(subscription.status === 'active' && invoice !== null && invoice.status === 'paid'
        && invoice.amount_remaining === 0 && invoice.customer === operation.stripeCustomerId
        && (!live || invoice.id === operation.lastPaidInvoiceId))
    }
    return subscription
  }

  function scheduleEvidence(raw: unknown, id: string, operation: ParsedOperation) {
    const schedule = decode(scheduleSchema, raw)
    requireFact(schedule.livemode === live && schedule.id === id && schedule.customer === operation.stripeCustomerId
      && schedule.subscription === operation.stripeSubscriptionId)
    return schedule
  }

  async function readState(operation: ParsedOperation, subscription: Subscription, id: string, at: number) {
    requireFact(subscription.schedule === id)
    const schedule = scheduleEvidence(await port.retrieveSchedule(id), id, operation)
    return { schedule, state: configurationState(schedule, operation, subscription, at) }
  }

  function mutationInput<Operation extends StripePlanChangeOperation>(
    input: ScheduleMutation<Operation>, action: 'attach' | 'configure',
  ) {
    const operation = scopedOperation(input.operation)
    const replayUntil = Date.parse(decode(time, input.replayUntil))
    requireFact(input.idempotencyKey === stripePlanChangeIdempotencyKey(operation.operationId, action)
      && typeof input.beforeMutation === 'function')
    return { operation, replayUntil }
  }

  function canWrite(operation: ParsedOperation, replayUntil: number) {
    const current = now()
    // Avoid initiating the provider write while the exact paid period or the
    // persisted idempotency window is about to expire.
    requireFact(current >= operation.starts * 1000
      && current + 5_000 < Math.min(operation.effective * 1000, replayUntil))
  }

  async function verify(candidate: PersistedSchedule) {
    const operation = scopedOperation(candidate)
    requireFact(!!operation.scheduleId)
    const at = now() / 1000
    const subscription = await readSubscription(operation, at)
    if (!subscription.schedule) return { kind: 'absent' } as const
    const { state } = await readState(operation, subscription, operation.scheduleId, at)
    if (state !== 'configured') return { kind: 'absent' } as const
    // The active phase's expanded price was checked on the subscription.
    // Independently resolve the other phase's immutable purchased terms.
    await readPrice(at < operation.effective ? operation.target : operation.source)
    return { kind: 'configured', scheduleId: operation.scheduleId, effectiveAt: operation.effectiveAt } as const
  }

  return {
    async attach(input: ScheduleMutation<StripePlanChangeOperation>) {
      const { operation, replayUntil } = mutationInput(input, 'attach')
      const at = now() / 1000
      requireFact(at < operation.effective)
      const subscription = await readSubscription(operation, at)
      if (subscription.schedule) {
        const id = operation.scheduleId ?? subscription.schedule
        const { schedule } = await readState(operation, subscription, id, at)
        if (!operation.scheduleId) {
          // Stripe does not accept metadata with from_subscription. A matching
          // creation event proves a lost response belongs to this exact request.
          const { data } = decode(eventsSchema, await port.listCreationEvents(schedule.created))
          if (!data.some(event => event.livemode === live && event.data.object.livemode === live
            && event.request?.idempotency_key === input.idempotencyKey
            && (event.account == null || event.account === operation.stripeAccount)
            && Math.abs(event.created - schedule.created) <= 1
            && event.data.object.id === id && event.data.object.customer === operation.stripeCustomerId
            && event.data.object.subscription === operation.stripeSubscriptionId)) {
            throw new StripePlanChangeCreationEvidencePending()
          }
        }
        return { kind: 'attached', scheduleId: id } as const
      }
      requireFact(!operation.scheduleId)
      await readPrice(operation.target, true)
      canWrite(operation, replayUntil)
      if (await input.beforeMutation() !== true) return { kind: 'stale' } as const
      canWrite(operation, replayUntil)
      const raw = await port.attachSchedule({ from_subscription: operation.stripeSubscriptionId },
        { idempotencyKey: input.idempotencyKey })
      const id = decode(z.object({ id: scheduleId }), raw).id
      const created = scheduleEvidence(raw, id, operation)
      requireFact(configurationState(created, operation, subscription, at) === 'attached')
      const readAt = now() / 1000
      const current = await readSubscription(operation, readAt)
      const { state } = await readState(operation, current, id, readAt)
      requireFact(state === 'attached')
      return { kind: 'attached', scheduleId: id } as const
    },

    async configure(input: ScheduleMutation<PersistedSchedule>) {
      const { operation, replayUntil } = mutationInput(input, 'configure')
      const id = operation.scheduleId
      requireFact(!!id)
      const at = now() / 1000
      const subscription = await readSubscription(operation, at)
      const { schedule, state } = await readState(operation, subscription, id, at)
      if (state === 'configured') {
        await readPrice(at < operation.effective ? operation.target : operation.source)
        return { kind: 'configured', scheduleId: id } as const
      }
      const defaultPaymentMethod = schedule.phases[0].default_payment_method
      const phaseSettings = {
        proration_behavior: 'none',
        automatic_tax: { enabled: false },
        collection_method: 'charge_automatically',
        discounts: '',
        ...(defaultPaymentMethod ? { default_payment_method: defaultPaymentMethod } : {}),
      } as const
      const params: Stripe.SubscriptionScheduleUpdateParams = {
        end_behavior: 'release',
        proration_behavior: 'none',
        metadata: operationMarker(operation),
        phases: [{
          ...phaseSettings, start_date: operation.starts, end_date: operation.effective,
          items: [{ price: operation.source.priceId, quantity: 1 }],
        }, {
          ...phaseSettings, start_date: operation.effective,
          duration: { interval: operation.target.interval, interval_count: 1 },
          billing_cycle_anchor: 'phase_start', items: [{ price: operation.target.priceId, quantity: 1 }],
        }],
      }
      await readPrice(operation.target, true)
      canWrite(operation, replayUntil)
      if (await input.beforeMutation() !== true) return { kind: 'stale' } as const
      canWrite(operation, replayUntil)
      const updated = scheduleEvidence(await port.updateSchedule(id, params, { idempotencyKey: input.idempotencyKey }), id, operation)
      requireFact(configurationState(updated, operation, subscription, at) === 'configured')
      const result = await verify(input.operation)
      requireFact(result.kind === 'configured')
      return { kind: 'configured', scheduleId: id } as const
    },

    verify,
  }
}
