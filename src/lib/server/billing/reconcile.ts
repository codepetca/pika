import { BillingWorkListSchema } from '@/lib/server/billing/contracts'
import {
  synchronizeBillingSubscription,
  type BillingProvider,
  type BillingStore,
} from '@/lib/server/billing/synchronize'

export type BillingReconciliationResult = {
  requested: number
  processed: number
  applied: number
  replayed: number
  deferred: number
  exceptions: number
}

/** Reconciles only due, already-bound subscriptions; it never discovers bindings from Stripe. */
export async function reconcileBillingSubscriptions(args: {
  store: BillingStore
  provider: BillingProvider
  limit: number
  leaseSeconds: number
}): Promise<BillingReconciliationResult> {
  if (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100) {
    throw new Error('Billing reconciliation limit is invalid')
  }

  const rawWork = await args.store.listWork({ limit: args.limit })
  const work = BillingWorkListSchema.safeParse(rawWork)
  if (!work.success || work.data.items.length > args.limit) {
    throw new Error('Billing reconciliation work is unavailable')
  }

  const result: BillingReconciliationResult = {
    requested: args.limit,
    processed: 0,
    applied: 0,
    replayed: 0,
    deferred: 0,
    exceptions: 0,
  }

  for (const item of work.data.items) {
    result.processed += 1
    try {
      const outcome = await synchronizeBillingSubscription({
        store: args.store,
        provider: args.provider,
        subscriptionId: item.subscription_id,
        eventInboxId: item.event_inbox_id,
        leaseSeconds: args.leaseSeconds,
      })
      if (outcome.kind === 'applied') result.applied += 1
      else if (outcome.kind === 'replayed') result.replayed += 1
      else if (outcome.kind === 'exception') result.exceptions += 1
      else result.deferred += 1
    } catch {
      // A contract/store failure for one durable item must not prevent the
      // remaining bounded claims from being reconciled on this run.
      result.exceptions += 1
    }
  }

  return result
}
