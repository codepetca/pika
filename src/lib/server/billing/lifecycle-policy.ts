import { z } from 'zod'
import { BillingAccessFactsSchema, type BillingAccessStatus } from './lifecycle-contracts'

/** Elapsed seconds, not Toronto calendar days. Display separately in Toronto. */
export const BILLING_TRIAL_SECONDS = 30 * 24 * 60 * 60
export const BILLING_RENEWAL_GRACE_SECONDS = 7 * 24 * 60 * 60

/** Pure mirror of the database's authoritative access read. No provider call is required. */
export function resolveBillingAccess(candidate: unknown, now: string): BillingAccessStatus {
  const facts = BillingAccessFactsSchema.parse(candidate)
  const at = Date.parse(z.string().datetime({ offset: true }).parse(now))
  const end = Date.parse(facts.access_ends_at)
  const started = at >= Date.parse(facts.starts_at)
  const pending = !facts.assignment_matches || (at >= end && facts.end_reason === 'renewal_pending')
  const expired = at >= end && !pending
  const state = pending ? 'synchronization_pending' : expired ? 'free'
    : facts.source === 'trial' ? 'trial'
      : facts.end_reason === 'renewal_grace' && facts.paid_through !== null && at >= Date.parse(facts.paid_through)
        ? 'renewal_grace' : 'paid'
  return {
    subject_user_id: facts.subject_user_id,
    state,
    plan_key: expired ? 'free' : facts.plan_key,
    offering_version_id: facts.offering_version_id,
    classroom_limit: expired ? 0 : facts.classroom_limit,
    access_ends_at: facts.end_reason === 'renewal_pending' ? null : facts.access_ends_at,
    renewal_at: facts.end_reason === 'renewal_pending' ? facts.paid_through : null,
    can_start_paid_work: started && !pending && !expired,
    retryable: pending,
    revision: facts.revision,
  }
}
