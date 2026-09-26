import { z } from 'zod'

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase())
const isoDateTimeSchema = z.string().datetime({ offset: true })
const providerReferenceSchema = z.string().trim().min(1).max(255)
const currencySchema = z.string().regex(/^[a-z]{3}$/)

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
  stripe_price_id: providerReferenceSchema,
  plan_key: z.enum(['basic', 'plus', 'pro']),
  currency: currencySchema,
  interval: z.enum(['month', 'year']),
  provider_mode: z.literal('test'),
}).strict()

export type BillingSubscriptionBinding = z.infer<typeof BillingSubscriptionBindingSchema>

const claimedSubscriptionSchema = z.object({
  status: z.literal('claimed'),
  subscription_id: uuidSchema,
  lease_token: uuidSchema,
  fencing_token: z.number().int().positive(),
  lease_expires_at: isoDateTimeSchema,
  subscription_revision: z.number().int().positive(),
  expected_account_plan_revision: z.number().int().positive(),
  binding: BillingSubscriptionBindingSchema,
}).strict()

export const BillingSubscriptionClaimSchema = z.discriminatedUnion('status', [
  claimedSubscriptionSchema,
  z.object({ status: z.literal('busy') }).strict(),
  z.object({ status: z.literal('not_found') }).strict(),
])

export type BillingSubscriptionClaim = z.infer<typeof BillingSubscriptionClaimSchema>
export type BillingClaimedSubscription = z.infer<typeof claimedSubscriptionSchema>

const billingWorkBaseSchema = z.object({
  subscription_id: uuidSchema,
  binding: BillingSubscriptionBindingSchema,
  next_attempt_at: isoDateTimeSchema.nullable(),
})

export const BillingWorkItemSchema = z.discriminatedUnion('kind', [
  billingWorkBaseSchema.extend({
    kind: z.literal('event'),
    event_inbox_id: uuidSchema,
  }).strict(),
  billingWorkBaseSchema.extend({
    kind: z.literal('reconcile'),
    event_inbox_id: z.null(),
  }).strict(),
])

export const BillingWorkListSchema = z.object({
  items: z.array(BillingWorkItemSchema).max(100),
}).strict()

export type BillingWorkItem = z.infer<typeof BillingWorkItemSchema>

export const BillingFinishResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('applied'), retry_scheduled: z.literal(false) }).strict(),
  z.object({ status: z.literal('replayed'), retry_scheduled: z.literal(false) }).strict(),
  z.object({ status: z.literal('lost_claim'), retry_scheduled: z.literal(true) }).strict(),
  z.object({ status: z.literal('plan_conflict'), retry_scheduled: z.literal(true) }).strict(),
  z.object({ status: z.literal('rejected'), retry_scheduled: z.boolean() }).strict(),
])

export type BillingFinishResult = z.infer<typeof BillingFinishResultSchema>

const providerItemSchema = z.object({
  priceId: providerReferenceSchema,
  currency: currencySchema,
  interval: z.enum(['month', 'year']),
  intervalCount: z.number().int().positive(),
  priceLiveMode: z.boolean(),
  quantity: z.number().int().nonnegative(),
  currentPeriodStart: isoDateTimeSchema,
  currentPeriodEnd: isoDateTimeSchema,
}).strict()

const providerInvoiceLineSchema = z.object({
  type: z.literal('subscription'),
  subscriptionId: providerReferenceSchema,
  priceId: providerReferenceSchema,
  quantity: z.number().int().nonnegative(),
  proration: z.boolean(),
  periodStart: isoDateTimeSchema,
  periodEnd: isoDateTimeSchema,
}).strict()

const providerInvoiceSchema = z.object({
  id: providerReferenceSchema,
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  amountDue: z.number().int().nonnegative(),
  amountPaid: z.number().int().nonnegative(),
  amountPaidOffStripe: z.number().int().nonnegative().optional(),
  currency: currencySchema,
  customerId: providerReferenceSchema,
  subscriptionId: providerReferenceSchema.nullable(),
  linesFullyEnumerated: z.literal(true),
  lines: z.array(providerInvoiceLineSchema).max(100),
  paymentsFullyEnumerated: z.literal(true),
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
  scheduleId: providerReferenceSchema.nullable(),
  items: z.array(providerItemSchema).max(100),
  latestInvoice: providerInvoiceSchema.nullable(),
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
  'invoice_paid_out_of_band',
  'invoice_payment_unapproved',
  'invoice_not_bound',
  'invoice_line_unverified',
])

export type BillingSynchronizationReason = z.infer<typeof BillingSynchronizationReasonSchema>

export type BillingFinishInput = {
  subscription_id: string
  lease_token: string
  fencing_token: number
  expected_subscription_revision: number
  expected_account_plan_revision: number
  outcome: 'paid' | 'noop' | 'exception'
  event_inbox_id: string | null
  invoice_id: string | null
  period_start: string | null
  period_end: string | null
  reason_code: BillingSynchronizationReason | null
}
