import { z } from 'zod'
import {
  RenewalCloseoutClaimResultSchema, RenewalCloseoutCheckpointResultSchema, RenewalCloseoutEvidenceSchema,
  RenewalCloseoutFinishSchema, RenewalCloseoutWorkSchema,
  type RenewalCloseoutClaim, type RenewalCloseoutCheckpointStage, type RenewalCloseoutFence,
  type RenewalCloseoutFinishRequest, type RenewalCloseoutProvider, type RenewalCloseoutStore,
} from './closeout-contracts'

type Dependencies = { store: RenewalCloseoutStore; provider: RenewalCloseoutProvider; leaseSeconds: number }
type Result = z.infer<typeof RenewalCloseoutFinishSchema> | { status: 'busy' | 'not_found' }
const stages: readonly string[] = ['queued', 'pause_requested', 'collection_paused', 'void_requested', 'invoice_voided', 'cancel_requested']
function fence(claim: RenewalCloseoutClaim): RenewalCloseoutFence {
  return { operation_id: claim.operation_id, subscription_id: claim.subscription_id, lease_token: claim.lease_token,
    fencing_token: claim.fencing_token, subscription_revision: claim.subscription_revision,
    expected_account_plan_revision: claim.expected_account_plan_revision, operation_revision: claim.operation_revision }
}
function sameIdentity(before: RenewalCloseoutClaim, after: RenewalCloseoutClaim): boolean {
  const { stage: _stage, operation_revision: _revision, ...expected } = before
  const { stage: _nextStage, operation_revision: _nextRevision, ...actual } = after
  return JSON.stringify(expected) === JSON.stringify(actual)
}

/** Only authoritative database claims and fresh provider evidence authorize each closeout action. */
export async function closeFailedRenewal(args: Dependencies & { subscriptionId: string }): Promise<Result> {
  const subscription_id = z.string().uuid().parse(args.subscriptionId)
  const lease_seconds = z.number().int().min(30).max(300).parse(args.leaseSeconds)
  const parsed = RenewalCloseoutClaimResultSchema.safeParse(await args.store.claim({ subscription_id, lease_seconds }))
  if (!parsed.success) throw new Error('Billing closeout claim is unavailable')
  if (parsed.data.status !== 'claimed') return parsed.data
  let claim = parsed.data
  if (claim.subscription_id !== subscription_id || claim.binding.subscription_id !== subscription_id
    || Date.parse(claim.cutoff) !== Date.parse(claim.paid_through) + 168 * 60 * 60 * 1000
    || ['closed', 'payment_won', 'superseded', 'attention'].includes(claim.stage)) {
    throw new Error('Billing closeout claim is unavailable')
  }
  const request = { binding: claim.binding, invoiceId: claim.invoice_id, paidThrough: claim.paid_through, cutoff: claim.cutoff }
  async function finish(input: Omit<RenewalCloseoutFinishRequest, keyof RenewalCloseoutFence>): Promise<Result> {
    const parsedFinish = RenewalCloseoutFinishSchema.safeParse(await args.store.finish({ ...fence(claim), ...input }))
    if (!parsedFinish.success) throw new Error('Billing closeout completion is unavailable')
    // A malformed store cannot claim a different successful financial outcome.
    if (['closed', 'payment_won', 'deferred', 'attention'].includes(parsedFinish.data.status)
      && parsedFinish.data.status !== input.outcome
      && !(input.outcome === 'deferred' && parsedFinish.data.status === 'attention')) {
      throw new Error('Billing closeout completion is unavailable')
    }
    return parsedFinish.data
  }
  async function checkpoint(stage: RenewalCloseoutCheckpointStage): Promise<Result | null> {
    const next = RenewalCloseoutCheckpointResultSchema.safeParse(await args.store.checkpoint({ ...fence(claim), stage }))
    if (!next.success) throw new Error('Billing closeout checkpoint is unavailable')
    if (next.data.status !== 'claimed') return next.data
    if (!sameIdentity(claim, next.data) || next.data.stage !== stage || next.data.operation_revision !== claim.operation_revision + 1) {
      throw new Error('Billing closeout checkpoint is unavailable')
    }
    claim = next.data
    return null
  }
  const attempted = new Set<'pause' | 'void' | 'cancel'>()
  // Each mutation runs at most once per invocation. Recovery starts with a read,
  // even when the saved stage says a previous write was requested.
  for (let step = 0; step < 4; step += 1) {
    let raw: unknown
    try { raw = await args.provider.readCloseoutEvidence(request) }
    catch { return finish({ outcome: 'deferred', reason: 'provider_unavailable' }) }
    const evidence = RenewalCloseoutEvidenceSchema.safeParse(raw)
    if (!evidence.success || ('invoiceId' in evidence.data && evidence.data.invoiceId !== claim.invoice_id)) {
      return finish({ outcome: 'attention', reason: 'incomplete_evidence' })
    }
    const state = evidence.data
    if (state.kind === 'attention') return finish({ outcome: 'attention', reason: state.reason, evidence: state })
    if (state.kind === 'payment_pending') return finish({ outcome: 'deferred', reason: 'payment_pending', evidence: state })
    if (state.kind === 'paid') {
      if (Date.parse(state.periodStart) !== Date.parse(claim.paid_through) || Date.parse(state.periodEnd) <= Date.parse(state.periodStart)) {
        return finish({ outcome: 'attention', reason: 'unexpected_money' })
      }
      return finish({ outcome: 'payment_won', evidence: state })
    }
    if (state.kind === 'invoice_voided' && !state.obligationsCleared) {
      return finish({ outcome: 'attention', reason: 'incomplete_evidence', evidence: state })
    }
    if (state.kind === 'invoice_voided' && state.subscriptionCanceled) return finish({ outcome: 'closed', evidence: state })
    const action = state.kind === 'invoice_voided' ? 'cancel' : state.collectionPaused ? 'void' : 'pause'
    if (attempted.has(action)) return finish({ outcome: 'deferred', reason: 'provider_state_unchanged', evidence: state })
    const requestedStage = action === 'pause' ? 'pause_requested' : action === 'void' ? 'void_requested' : 'cancel_requested'
    if (stages.indexOf(requestedStage) < stages.indexOf(claim.stage)) {
      return finish({ outcome: 'attention', reason: 'incomplete_evidence', evidence: state })
    }
    if (action === 'void' && stages.indexOf(claim.stage) < stages.indexOf('collection_paused')) {
      const stopped = await checkpoint('collection_paused')
      if (stopped) return stopped
    }
    if (action === 'cancel' && stages.indexOf(claim.stage) < stages.indexOf('invoice_voided')) {
      const stopped = await checkpoint('invoice_voided')
      if (stopped) return stopped
    }
    const stopped = await checkpoint(requestedStage)
    if (stopped) return stopped
    attempted.add(action)
    let writeFenceFailure: Result | null = null
    let writeCheckpointFailed = false
    const mutationRequest = { ...request, beforeMutation: async () => {
      try { writeFenceFailure = await checkpoint(requestedStage) }
      catch { writeCheckpointFailed = true; throw new Error('Billing closeout checkpoint is unavailable') }
      return writeFenceFailure === null
    } }
    try {
      if (action === 'pause') await args.provider.pauseInvoiceCollection({ ...mutationRequest, idempotencyKey: `${claim.operation_id}:pause` })
      else if (action === 'void') await args.provider.voidInvoice({ ...mutationRequest, idempotencyKey: `${claim.operation_id}:void` })
      else await args.provider.cancelSubscription(mutationRequest)
    } catch {
      if (writeCheckpointFailed) throw new Error('Billing closeout checkpoint is unavailable')
      return finish({ outcome: 'deferred', reason: 'provider_unavailable' })
    }
    if (writeFenceFailure) return writeFenceFailure
  }
  return finish({ outcome: 'deferred', reason: 'provider_state_unchanged' })
}

export async function closeDueRenewals(args: Dependencies & { limit: number }) {
  const limit = z.literal(1).parse(args.limit)
  z.number().int().min(30).max(300).parse(args.leaseSeconds)
  const work = RenewalCloseoutWorkSchema.safeParse(await args.store.listDue({ limit }))
  if (!work.success) throw new Error('Billing closeout work is unavailable')
  const result = { requested: limit, processed: 0, closed: 0, paymentWon: 0, deferred: 0, attention: 0, exceptions: 0 }
  for (const item of work.data.items) {
    result.processed += 1
    try {
      const outcome = await closeFailedRenewal({ ...args, subscriptionId: item.subscription_id })
      if (outcome.status === 'closed') result.closed += 1
      else if (outcome.status === 'payment_won') result.paymentWon += 1
      else if (outcome.status === 'attention') result.attention += 1
      else result.deferred += 1
    } catch { result.exceptions += 1 }
  }
  return result
}
