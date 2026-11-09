import { exclusiveInvoiceTaxEvidenceSchema, stripeExclusiveTaxModeSchema } from './billing-tax'
import { z } from 'zod'
import { BillingLifecycleClaimFactsSchema } from './lifecycle-contracts'

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase())
const isoDateTimeSchema = z.string().datetime({ offset: true })
const providerReferenceSchema = z.string().trim().min(1).max(255)
const currencySchema = z.string().regex(/^[a-z]{3}$/)
const safeMoneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const safeIntegerSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)

/**
 * The immutable server-side binding. A Stripe payload or its metadata is never
 * a source for this record; it is created only by the approved purchase flow.
 */
export const BillingSubscriptionBindingSchema = z.object({
  subscription_id: uuidSchema,
  subject_user_id: uuidSchema,
  stripe_account: providerReferenceSchema,
  stripe_customer_id: providerReferenceSchema,
  stripe_subscription_id: providerReferenceSchema,
  offering_id: uuidSchema,
  offering_version_id: uuidSchema,
  stripe_product_id: providerReferenceSchema,
  stripe_price_id: providerReferenceSchema,
  unit_amount: safeMoneySchema,
  plan_key: z.enum(['basic', 'plus', 'pro']),
  currency: currencySchema,
  interval: z.enum(['month', 'year']),
  provider_mode: z.literal('test'),
}).strict()

export type BillingSubscriptionBinding = z.infer<typeof BillingSubscriptionBindingSchema>

export const BillingReconciliationScopeSchema = z.object({
  stripeAccount: z.string().regex(/^acct_[A-Za-z0-9]{1,240}$/),
  providerMode: z.enum(['test', 'live']),
}).strict()

export type BillingReconciliationScope = z.infer<typeof BillingReconciliationScopeSchema>

export const LiveBillingSubscriptionBindingSchema = BillingSubscriptionBindingSchema.extend({
  provider_mode: z.literal('live'),
  tax_mode: stripeExclusiveTaxModeSchema.optional(),
})
export type BillingReconciliationBinding = BillingSubscriptionBinding | z.infer<typeof LiveBillingSubscriptionBindingSchema>

/** Existing callers stay sandbox-only when no explicit scope is supplied. */
export function matchesBillingReconciliationScope(
  binding: BillingReconciliationBinding,
  scope?: BillingReconciliationScope,
): boolean {
  return scope === undefined
    ? binding.provider_mode === 'test'
    : binding.provider_mode === scope.providerMode && binding.stripe_account === scope.stripeAccount
}

export const BillingScheduledRenewalSchema = z.object({
  operation_id: uuidSchema,
  provider_schedule_id: z.string().regex(/^sub_sched_[A-Za-z0-9]{1,240}$/),
  effective_at: isoDateTimeSchema,
  state: z.enum(['scheduled', 'applied']),
  target_binding: z.discriminatedUnion('provider_mode', [BillingSubscriptionBindingSchema, LiveBillingSubscriptionBindingSchema]),
}).strict()

export type BillingScheduledRenewal = z.infer<typeof BillingScheduledRenewalSchema>

const claimedSubscriptionSchema = z.object({
  status: z.literal('claimed'),
  subscription_id: uuidSchema,
  lease_token: uuidSchema,
  fencing_token: z.number().int().positive(),
  lease_expires_at: isoDateTimeSchema,
  subscription_revision: z.number().int().positive(),
  expected_account_plan_revision: z.number().int().positive(),
  binding: BillingSubscriptionBindingSchema,
  lifecycle: BillingLifecycleClaimFactsSchema.optional(),
}).strict()

const unavailableClaimSchemas = [
  z.object({ status: z.literal('busy') }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
] as const

export const BillingSubscriptionClaimSchema = z.discriminatedUnion('status', [
  claimedSubscriptionSchema,
  ...unavailableClaimSchemas,
])

export type BillingSubscriptionClaim = z.infer<typeof BillingSubscriptionClaimSchema>
export type BillingClaimedSubscription = z.infer<typeof claimedSubscriptionSchema>

const liveClaimedSubscriptionSchema = claimedSubscriptionSchema.extend({
  binding: LiveBillingSubscriptionBindingSchema,
  lifecycle: BillingLifecycleClaimFactsSchema,
})
export const LiveBillingSubscriptionClaimSchema = z.discriminatedUnion('status', [
  liveClaimedSubscriptionSchema,
  ...unavailableClaimSchemas,
])
export type BillingReconciliationClaim = BillingClaimedSubscription | z.infer<typeof liveClaimedSubscriptionSchema>

const billingWorkBaseSchema = z.object({
  subscription_id: uuidSchema,
  binding: BillingSubscriptionBindingSchema,
  next_attempt_at: isoDateTimeSchema.nullable(),
})

const eventWorkItemSchema = billingWorkBaseSchema.extend({
  kind: z.literal('event'),
  event_inbox_id: uuidSchema,
}).strict()
const reconcileWorkItemSchema = billingWorkBaseSchema.extend({
  kind: z.literal('reconcile'),
  event_inbox_id: z.null(),
}).strict()

export const BillingWorkItemSchema = z.discriminatedUnion('kind', [
  eventWorkItemSchema,
  reconcileWorkItemSchema,
])

export const BillingWorkListSchema = z.object({
  items: z.array(BillingWorkItemSchema).max(100),
}).strict()

export const LiveBillingWorkListSchema = BillingWorkListSchema.extend({
  items: z.array(z.discriminatedUnion('kind', [
    eventWorkItemSchema.extend({ binding: LiveBillingSubscriptionBindingSchema }),
    reconcileWorkItemSchema.extend({ binding: LiveBillingSubscriptionBindingSchema }),
  ])).max(100),
})

export type BillingWorkItem = z.infer<typeof BillingWorkItemSchema>

export const BillingFinishResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), retry_scheduled: z.literal(false) }).strict(),
  z.object({ status: z.literal('replayed'), retry_scheduled: z.literal(false) }).strict(),
  z.object({ status: z.literal('deferred'), retry_scheduled: z.literal(true) }).strict(),
  z.object({ status: z.literal('attention'), retry_scheduled: z.literal(false) }).strict(),
  z.object({ status: z.literal('lost_claim'), retry_scheduled: z.literal(true) }).strict(),
  z.object({ status: z.literal('plan_conflict'), retry_scheduled: z.literal(true) }).strict(),
  z.object({ status: z.literal('rejected'), retry_scheduled: z.boolean() }).strict(),
])

export type BillingFinishResult = z.infer<typeof BillingFinishResultSchema>

const providerItemSchema = z.object({
  productId: providerReferenceSchema,
  priceId: providerReferenceSchema,
  unitAmount: safeMoneySchema,
  currency: currencySchema,
  interval: z.enum(['month', 'year']),
  intervalCount: z.number().int().positive(),
  priceLiveMode: z.boolean(),
  priceTaxBehavior: z.literal('exclusive').optional(),
  quantity: z.number().int().nonnegative(),
  currentPeriodStart: isoDateTimeSchema,
  currentPeriodEnd: isoDateTimeSchema,
}).strict()

const providerInvoiceLineSchema = z.object({
  type: z.literal('subscription'),
  subscriptionId: providerReferenceSchema,
  priceId: providerReferenceSchema,
  amount: safeMoneySchema,
  quantity: z.number().int().nonnegative(),
  proration: z.boolean(),
  hasDiscounts: z.boolean(),
  hasTaxes: z.boolean(),
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
}).strict()

const providerInvoiceSchema = z.object({
  id: providerReferenceSchema,
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  billingReason: providerReferenceSchema,
  subtotal: safeMoneySchema,
  total: safeMoneySchema,
  startingBalance: safeIntegerSchema,
  endingBalance: safeIntegerSchema.nullable(),
  totalDiscountAmount: safeMoneySchema,
  totalTaxAmount: safeMoneySchema,
  exclusiveTax: exclusiveInvoiceTaxEvidenceSchema.optional(),
  hasDiscounts: z.boolean(),
  hasTaxes: z.boolean(),
  prePaymentCreditNotesAmount: safeMoneySchema,
  postPaymentCreditNotesAmount: safeMoneySchema,
  amountDue: z.number().int().nonnegative(),
  amountPaid: z.number().int().nonnegative(),
  amountPaidOffStripe: z.number().int().nonnegative().optional(),
  currency: currencySchema,
  customerId: providerReferenceSchema,
  subscriptionId: providerReferenceSchema.nullable(),
  linesFullyEnumerated: z.literal(true),
  lines: z.array(providerInvoiceLineSchema).max(100),
  paymentsFullyEnumerated: z.literal(true),
  modeEvidence: z.object({
    invoice: z.boolean(),
    invoicePayments: z.array(z.boolean()).max(100),
    paidPayment: z.object({
      paymentIntent: z.boolean(),
      charge: z.boolean(),
      amountCaptured: safeMoneySchema.optional(),
    }).strict().optional(),
  }).strict().optional(),
  payments: z.array(z.object({
    type: z.literal('payment_intent'),
    status: z.literal('succeeded'),
    paymentIntentId: providerReferenceSchema,
    customerId: providerReferenceSchema,
    currency: currencySchema,
    amountReceived: z.number().int().positive(),
    latestCharge: z.object({
      status: z.literal('succeeded'),
      paid: z.literal(true),
      captured: z.literal(true),
      refunded: z.literal(false),
      amountRefunded: z.literal(0),
      disputed: z.literal(false),
      customerId: providerReferenceSchema,
      currency: currencySchema,
      paymentIntentId: providerReferenceSchema,
      paymentMethodType: providerReferenceSchema,
    }).strict(),
  }).strict()).max(100),
}).strict()

/** The provider adapter must decode SDK values into this data-only snapshot. */
export const BillingProviderSubscriptionSnapshotSchema = z.object({
  stripeAccount: providerReferenceSchema,
  liveMode: z.boolean(),
  isCurrent: z.boolean(),
  subscriptionId: providerReferenceSchema,
  customerId: providerReferenceSchema,
  status: z.enum([
    'active',
    'trialing',
    'past_due',
    'unpaid',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'paused',
  ]),
  pendingUpdate: z.boolean(),
  cancelAt: isoDateTimeSchema.nullable(),
  cancelAtPeriodEnd: z.boolean(),
  pauseCollection: z.boolean(),
  automaticTaxEnabled: z.literal(true).optional(),
  scheduleId: providerReferenceSchema.nullable(),
  items: z.array(providerItemSchema).max(100),
  latestInvoice: providerInvoiceSchema.nullable(),
  terminalObligationsCleared: z.boolean().optional(),
}).strict()

export type BillingProviderSubscriptionSnapshot = z.infer<typeof BillingProviderSubscriptionSnapshotSchema>

export const BillingSynchronizationReasonSchema = z.enum([
  'provider_unavailable',
  'provider_snapshot_invalid',
  'provider_environment_invalid',
  'subscription_not_current',
  'subscription_not_active',
  'subscription_pending_update',
  'subscription_transition_unapproved',
  'subscription_not_bound',
  'subscription_item_invalid',
  'changed_price',
  'invoice_missing',
  'invoice_not_paid',
  'renewal_invoice_pending',
  'invoice_paid_out_of_band',
  'invoice_payment_unapproved',
  'invoice_not_bound',
  'invoice_line_unverified',
  'financial_terms_unapproved',
])

export type BillingSynchronizationReason = z.infer<typeof BillingSynchronizationReasonSchema>

export type BillingFinishInput = {
  subscription_id: string
  lease_token: string
  fencing_token: number
  expected_subscription_revision: number
  expected_account_plan_revision: number
  outcome: 'paid' | 'noop' | 'exception' | 'renewal_failed' | 'renewal_invoice_pending' | 'canceled' | 'observed'
  event_inbox_id: string | null
  invoice_id: string | null
  period_start: string | null
  period_end: string | null
  reason_code: BillingSynchronizationReason | null
  provider_status?: string
  cancel_at_period_end?: boolean
  obligations_cleared?: boolean
}

export type BillingScheduledRenewalFinishInput = BillingFinishInput & {
  operation_id: string
  provider_schedule_id: string
  target_offering_version_id: string
}
