import { isDeepStrictEqual } from 'node:util'
import {
  stripePlanChangeIdempotencyKey,
  StripePlanChangeContractError,
  StripePlanChangeCreationEvidencePending,
  type createStripePlanChangeProvider,
  type StripePlanChangeOperation,
} from './stripe-plan-change-provider'

type Installation =
  | { stage: 'confirmed'; scheduleId?: never; replayUntil?: never }
  | { stage: 'attach_requested'; scheduleId?: never; replayUntil: string }
  | { stage: 'attached'; scheduleId: string; replayUntil?: never }
  | { stage: 'configure_requested'; scheduleId: string; replayUntil: string }

type InstallationFence = {
  operationId: string
  subscriptionId: string
  leaseToken: string
  fencingToken: number
  subscriptionRevision: number
  operationRevision: number
}

type InstallationClaim = {
  fence: InstallationFence
  operation: Omit<StripePlanChangeOperation, 'scheduleId'> & { providerMode?: 'live'; lastPaidInvoiceId?: string }
  installation: Installation
}

type Checkpoint = { action: 'begin_attach' } | { action: 'record_attach'; scheduleId: string }
  | { action: 'begin_configure' } | { action: 'authorize_write' }
type Finish = { outcome: 'installed'; scheduleId: string }
  | { outcome: 'retry' | 'attention' | 'expired' | 'deferred' }

export type ScheduledPlanChangeInstallationStore = {
  claim(operationId: string): Promise<InstallationClaim | null>
  checkpoint(fence: InstallationFence, checkpoint: Checkpoint): Promise<InstallationClaim | null>
  finish(fence: InstallationFence, finish: Finish): Promise<boolean>
}

type ScheduledPlanChangeProvider = ReturnType<typeof createStripePlanChangeProvider>

/** Persist each possible write before calling Stripe. A retry reuses that stage's persisted deadline. */
export async function installScheduledPlanChange(input: {
  operationId: string
  stripeAccount: string
  providerMode?: 'test' | 'live'
  store: ScheduledPlanChangeInstallationStore
  provider: Pick<ScheduledPlanChangeProvider, 'attach' | 'configure'>
  now?: () => number
}): Promise<'busy' | 'lost_claim' | Finish['outcome']> {
  const { operationId, stripeAccount, store, provider, now = Date.now, providerMode = 'test' } = input
  const initial = await store.claim(operationId)
  if (!initial) return 'busy'
  if (initial.fence.operationId !== operationId || initial.operation.operationId !== operationId
    || initial.operation.stripeAccount !== stripeAccount
    || (providerMode === 'live' ? initial.operation.providerMode !== 'live'
      || !/^in_[A-Za-z0-9]{1,240}$/.test(initial.operation.lastPaidInvoiceId ?? '')
      : initial.operation.providerMode !== undefined || initial.operation.lastPaidInvoiceId !== undefined
        || initial.operation.taxMode !== undefined)) throw new Error('Invalid scheduled change claim')
  let claim = initial
  let writeRefused = false

  async function advance(checkpoint: Checkpoint, expected: Installation['stage']) {
    const before = claim
    const next = await store.checkpoint(before.fence, checkpoint)
    if (!next) {
      if (['begin_attach', 'begin_configure', 'authorize_write'].includes(checkpoint.action)) writeRefused = true
      return false
    }
    if (next.fence.operationId !== operationId || next.fence.subscriptionId !== before.fence.subscriptionId
      || next.fence.leaseToken !== before.fence.leaseToken || next.fence.fencingToken !== before.fence.fencingToken
      || next.installation.stage !== expected || !isDeepStrictEqual(next.operation, before.operation)
      || (before.installation.scheduleId && next.installation.scheduleId !== before.installation.scheduleId)
      || (checkpoint.action === 'record_attach' && next.installation.scheduleId !== checkpoint.scheduleId)
      || (checkpoint.action === 'authorize_write' && next.installation.replayUntil !== before.installation.replayUntil)) {
      throw new Error('Invalid scheduled change checkpoint')
    }
    claim = next
    return true
  }

  async function finish(result: Finish) {
    return await store.finish(claim.fence, result) ? result.outcome : 'lost_claim'
  }

  async function lostOrDeferred() {
    return providerMode === 'live' && writeRefused ? finish({ outcome: 'deferred' }) : 'lost_claim' as const
  }

  try {
    // Only a pristine intent is safe to expire without inspecting Stripe.
    if (claim.installation.stage === 'confirmed' && now() >= Date.parse(claim.operation.effectiveAt)) {
      return finish({ outcome: 'expired' })
    }
    if (claim.installation.stage === 'confirmed' && !await advance({ action: 'begin_attach' }, 'attach_requested')) {
      return lostOrDeferred()
    }
    if (claim.installation.stage === 'attach_requested') {
      const attached = await provider.attach({
        operation: claim.operation, idempotencyKey: stripePlanChangeIdempotencyKey(operationId, 'attach'),
        replayUntil: claim.installation.replayUntil,
        beforeMutation: () => advance({ action: 'authorize_write' }, 'attach_requested'),
      })
      if (attached.kind === 'stale') return lostOrDeferred()
      if (!await advance({ action: 'record_attach', scheduleId: attached.scheduleId }, 'attached')) return 'lost_claim'
    }
    if (claim.installation.stage === 'attached' && !await advance({ action: 'begin_configure' }, 'configure_requested')) {
      return lostOrDeferred()
    }
    if (claim.installation.stage !== 'configure_requested') throw new Error('Invalid scheduled change stage')
    const scheduleId = claim.installation.scheduleId
    const configured = await provider.configure({
      operation: { ...claim.operation, scheduleId }, idempotencyKey: stripePlanChangeIdempotencyKey(operationId, 'configure'),
      replayUntil: claim.installation.replayUntil,
      beforeMutation: () => advance({ action: 'authorize_write' }, 'configure_requested'),
    })
    if (configured.kind === 'stale') return lostOrDeferred()
    if (configured.scheduleId !== scheduleId) return finish({ outcome: 'attention' })
    return finish({ outcome: 'installed', scheduleId })
  } catch (error) {
    return finish({ outcome: error instanceof StripePlanChangeContractError
      && !(error instanceof StripePlanChangeCreationEvidencePending) ? 'attention' : 'retry' })
  }
}
