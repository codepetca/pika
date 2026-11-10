import { z } from 'zod'
import { fetchJSON } from '@/lib/request-cache'

export const BILLING_ACCESS_NOTICE_HEADER = 'x-pika-billing-access-notice'

const BillingAccessNoticeSchema = z.enum(['payment_overdue', 'ending_within_24_hours', 'ending_within_seven_days', 'ended'])
export type BillingAccessNotice = z.infer<typeof BillingAccessNoticeSchema>

/** Customer-facing state; Stripe references and internal legacy tier keys stay server-side. */
export const BillingSubscriptionStatusSchema = z.object({
  state: z.enum(['free', 'trial', 'paid', 'renewal_grace', 'synchronization_pending', 'unmanaged']),
  plan: z.enum(['free', 'basic', 'pro', 'max']),
  classroomLimit: z.number().int().nonnegative(),
  accessEndsAt: z.string().datetime({ offset: true }).nullable(),
  renewalAt: z.string().datetime({ offset: true }).nullable(),
  accessNotice: BillingAccessNoticeSchema.optional(),
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

export async function fetchBillingSubscription(signal?: AbortSignal): Promise<BillingSubscriptionStatus> {
  const response = await fetchJSON<unknown>('/api/billing/subscription', {
    init: { cache: 'no-store', headers: { [BILLING_ACCESS_NOTICE_HEADER]: '1' }, signal },
  })
  return BillingSubscriptionStatusSchema.parse(response)
}

export function billingDate(value: string, includeSeconds = false) {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    ...(includeSeconds && { second: '2-digit' }), timeZone: 'America/Toronto', timeZoneName: 'short',
  }).format(new Date(value))
}
