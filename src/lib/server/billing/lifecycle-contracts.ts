import { z } from 'zod'

const uuid = z.string().uuid()
const instant = z.string().datetime({ offset: true })
const billingAccessEndReason = z.enum(['trial', 'cancellation', 'renewal_grace', 'renewal_pending', 'refund'])
export const BillingAccessStatusSchema = z.object({
  subject_user_id: uuid,
  state: z.enum(['free', 'trial', 'paid', 'renewal_grace', 'synchronization_pending', 'unmanaged']),
  plan_key: z.enum(['free', 'basic', 'plus', 'pro']),
  offering_version_id: uuid.nullable(),
  classroom_limit: z.number().int().nonnegative(),
  access_ends_at: instant.nullable(),
  renewal_at: instant.nullable(),
  can_start_paid_work: z.boolean(),
  retryable: z.boolean(),
  revision: z.number().int().nonnegative(),
  customer_options: z.object({
    trial_available: z.boolean(),
    has_billing_customer: z.boolean(),
    checkout_available: z.boolean(),
    pending_checkout_id: uuid.nullable(),
    paid_terms: z.object({
      currency: z.enum(['usd', 'cad']),
      interval: z.enum(['month', 'year']),
      unit_amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      upgrade_available: z.boolean(),
    }).strict().nullable(),
  }).strict().optional(),
}).strict()
export type BillingAccessStatus = z.infer<typeof BillingAccessStatusSchema>

export const BillingAccessFactsSchema = z.object({
  subject_user_id: uuid,
  source: z.enum(['trial', 'paid']),
  plan_key: z.enum(['basic', 'plus', 'pro']),
  offering_version_id: uuid.nullable(),
  classroom_limit: z.number().int().nonnegative(),
  starts_at: instant,
  paid_through: instant.nullable(),
  access_ends_at: instant,
  end_reason: billingAccessEndReason,
  assignment_matches: z.boolean(),
  revision: z.number().int().positive(),
}).strict()
export type BillingAccessFacts = z.infer<typeof BillingAccessFactsSchema>

export const BillingLifecycleClaimFactsSchema = z.object({
  paid_through: instant.nullable(),
  paid_period_start: instant.nullable(),
  last_paid_invoice_id: z.string().min(1).nullable(),
  access_ends_at: instant.nullable(),
  end_reason: billingAccessEndReason.nullable(),
  assignment_revision: z.number().int().positive().nullable(),
  is_current: z.boolean(),
}).strict()
export type BillingLifecycleClaimFacts = z.infer<typeof BillingLifecycleClaimFactsSchema>
