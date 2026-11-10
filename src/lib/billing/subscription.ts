import { z } from 'zod'

/** Customer-facing state; Stripe references and internal legacy tier keys stay server-side. */
export const BillingSubscriptionStatusSchema = z.object({
  state: z.enum(['free', 'trial', 'paid', 'renewal_grace', 'synchronization_pending', 'unmanaged']),
  plan: z.enum(['free', 'basic', 'pro', 'max']),
  classroomLimit: z.number().int().nonnegative(),
  accessEndsAt: z.string().datetime({ offset: true }).nullable(),
  renewalAt: z.string().datetime({ offset: true }).nullable(),
  canStartPaidWork: z.boolean(),
  retryable: z.boolean(),
  options: z.object({
    trialAvailable: z.boolean(),
    hasBillingCustomer: z.boolean(),
    checkoutAvailable: z.boolean(),
    pendingCheckoutId: z.string().uuid().nullable(),
    paidTerms: z.object({
      currency: z.enum(['usd', 'cad']),
      interval: z.enum(['month', 'year']),
      unitAmount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      upgradeAvailable: z.boolean(),
    }).strict().nullable(),
  }).strict().optional(),
}).strict()
export type BillingSubscriptionStatus = z.infer<typeof BillingSubscriptionStatusSchema>
