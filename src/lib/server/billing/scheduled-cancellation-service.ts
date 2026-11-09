import { isDeepStrictEqual } from 'node:util'
import { scheduledTermEnd } from './scheduled-plan-change-period'
import { z } from 'zod'
import { BillingProviderSubscriptionSnapshotSchema, BillingSubscriptionBindingSchema } from './contracts'
import { stripePlanChangeOperationSchema, StripePlanChangeContractError, type createLiveScheduledCancellationProvider } from './stripe-plan-change-provider'

const uuid = z.uuid()
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
export const cancellationClaimSchema = z.strictObject({
  fence: z.strictObject({ operationId: uuid, subscriptionId: uuid, leaseToken: uuid, fencingToken: revision,
    subscriptionRevision: revision, operationRevision: revision }),
  operation: stripePlanChangeOperationSchema.extend({ scheduleId: z.string().regex(/^sub_sched_[A-Za-z0-9]{1,240}$/),
    providerMode: z.literal('live'), lastPaidInvoiceId: z.string().regex(/^in_[A-Za-z0-9]{1,240}$/) }),
  cancellationOperationId: uuid, action: z.enum(['cancel', 'undo']), replayUntil: z.iso.datetime({ offset: true }),
  readOnly: z.boolean(),
  binding: BillingSubscriptionBindingSchema.extend({ provider_mode: z.literal('live') }),
})
type Claim = z.infer<typeof cancellationClaimSchema>
type Outcome = 'canceled' | 'restored' | 'restored_after_cutoff' | 'unchanged_after_cutoff' | 'completed' | 'retry' | 'attention' | 'deferred'
type Evidence = { ended_at: string; obligations_cleared: true } | { provider_schedule_id: string; period_start: string; period_end: string }
export type CancellationStore = {
  claim(id: string): Promise<Claim | null>
  authorize(fence: Claim['fence']): Promise<Claim | null>
  finish(fence: Claim['fence'], outcome: Outcome, evidence?: Evidence): Promise<boolean>
}
type Provider = ReturnType<typeof createLiveScheduledCancellationProvider>
export async function processScheduledCancellation(input: {
  id: string; stripeAccount: string; store: CancellationStore; provider: Provider;
  retrieveSubscription(binding: Claim['binding']): Promise<unknown>
}) {
  const initial = await input.store.claim(input.id)
  if (!initial) return 'busy' as const
  let claim = cancellationClaimSchema.parse(initial)
  const op = claim.operation; const binding = claim.binding
  if (claim.cancellationOperationId !== input.id || claim.fence.operationId !== input.id
    || claim.fence.subscriptionId !== binding.subscription_id || op.stripeAccount !== input.stripeAccount
    || binding.stripe_account !== input.stripeAccount || binding.stripe_subscription_id !== op.stripeSubscriptionId
    || binding.stripe_customer_id !== op.stripeCustomerId || binding.stripe_price_id !== op.source.priceId
    || binding.stripe_product_id !== op.source.productId || binding.unit_amount !== op.source.unitAmount
    || binding.currency !== op.source.currency || binding.interval !== op.source.interval || binding.plan_key !== 'pro') {
    throw new Error('Invalid scheduled cancellation claim')
  }
  async function finish(outcome: Outcome, evidence?: Evidence) {
    return await input.store.finish(claim.fence, outcome, evidence) ? outcome : 'lost_claim' as const
  }
  let refused = false
  async function beforeMutation() {
    const next = await input.store.authorize(claim.fence)
    if (!next) { refused = true; return false }
    const validated = cancellationClaimSchema.parse(next)
    if (validated.fence.operationId !== claim.fence.operationId || validated.fence.subscriptionId !== claim.fence.subscriptionId
      || validated.fence.leaseToken !== claim.fence.leaseToken || validated.fence.fencingToken !== claim.fence.fencingToken
      || !isDeepStrictEqual(validated.operation, claim.operation) || !isDeepStrictEqual(validated.binding, claim.binding)
      || validated.cancellationOperationId !== claim.cancellationOperationId || validated.action !== claim.action
      || validated.replayUntil !== claim.replayUntil || validated.readOnly !== claim.readOnly) throw new Error('Invalid cancellation checkpoint')
    claim = validated
    return true
  }
  try {
    const request = { operation: claim.operation, cancellationOperationId: claim.cancellationOperationId }
    const observed = await input.provider.read(request)
    async function complete() {
      const snapshot = BillingProviderSubscriptionSnapshotSchema.safeParse(await input.retrieveSubscription(binding))
      if (!snapshot.success) return finish('retry')
      const current = snapshot.data; const item = current.items[0]
      if (!current.isCurrent || !current.liveMode || current.stripeAccount !== input.stripeAccount
        || current.status !== 'canceled' || current.subscriptionId !== op.stripeSubscriptionId
        || current.customerId !== op.stripeCustomerId || current.scheduleId !== op.scheduleId
        || current.pendingUpdate || current.pauseCollection || current.terminalObligationsCleared !== true
        || current.items.length !== 1 || !item.priceLiveMode || item.quantity !== 1
        || item.priceId !== op.source.priceId || item.productId !== op.source.productId
        || item.unitAmount !== op.source.unitAmount || item.currency !== op.source.currency
        || item.interval !== op.source.interval || item.intervalCount !== 1
        || Date.parse(item.currentPeriodStart) !== Date.parse(op.paidPeriodStart)
        || Date.parse(item.currentPeriodEnd) !== Date.parse(op.effectiveAt)
        || current.latestInvoice?.id !== op.lastPaidInvoiceId || current.latestInvoice.status !== 'paid') return finish('retry')
      return finish('completed', { ended_at: op.effectiveAt, obligations_cleared: true })
    }
    if (observed.kind === 'completed') return complete()
    if (observed.kind === 'transition_pending') return finish('retry')
    function handoff() {
      return finish(claim.action === 'undo' ? 'restored_after_cutoff' : 'unchanged_after_cutoff', {
        provider_schedule_id: op.scheduleId, period_start: op.effectiveAt,
        period_end: new Date(scheduledTermEnd(op.effectiveAt, op.target.interval)).toISOString(),
      })
    }
    if (observed.kind === 'restored_after_cutoff') return handoff()
    if (claim.readOnly) {
      if (claim.action === 'cancel' && observed.kind === 'cancel_scheduled') return finish('canceled')
      if (claim.action === 'undo' && observed.kind === 'scheduled') return finish('restored')
      return finish('attention')
    }
    const mutation = { ...request, replayUntil: claim.replayUntil, beforeMutation }
    const result = claim.action === 'cancel' ? await input.provider.cancel(mutation) : await input.provider.undo(mutation)
    if (result.kind === 'stale') return refused ? finish('deferred') : 'lost_claim'
    if (result.kind === 'completed') return complete()
    if (result.kind === 'transition_pending') return finish('retry')
    if (result.kind === 'restored_after_cutoff') return handoff()
    if (claim.action === 'cancel' && result.kind === 'cancel_scheduled') return finish('canceled')
    if (claim.action === 'undo' && result.kind === 'scheduled') return finish('restored')
    return finish('attention')
  } catch (error) {
    return finish(error instanceof StripePlanChangeContractError ? 'attention' : 'retry')
  }
}
