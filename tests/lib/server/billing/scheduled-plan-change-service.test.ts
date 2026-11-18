import { describe, expect, it, vi } from 'vitest'
import {
  installScheduledPlanChange,
  type ScheduledPlanChangeInstallationStore,
} from '@/lib/server/billing/scheduled-plan-change-service'
import { StripePlanChangeContractError, StripePlanChangeCreationEvidencePending } from '@/lib/server/billing/stripe-plan-change-provider'

type Claim = NonNullable<Awaited<ReturnType<ScheduledPlanChangeInstallationStore['claim']>>>
const operationId = '817e28b2-b87f-4de9-b395-548f96e7461a'
const scheduleId = 'sub_sched_recovery'
const replayUntil = '2026-11-10T00:00:00Z'
const effectiveAt = '2026-11-20T00:00:00Z'

function fixture(installation: Claim['installation'] = { stage: 'confirmed' }) {
  const initial: Claim = {
    fence: { operationId, subscriptionId: 'binding', leaseToken: 'lease', fencingToken: 1,
      subscriptionRevision: 2, operationRevision: 3 },
    operation: { operationId, stripeAccount: 'acct_billing', stripeCustomerId: 'cus_billing', stripeSubscriptionId: 'sub_billing',
      paidPeriodStart: '2026-10-20T00:00:00Z', effectiveAt,
      source: { priceId: 'price_max', productId: 'prod_max', currency: 'usd', interval: 'month', unitAmount: 3900 },
      target: { priceId: 'price_pro', productId: 'prod_pro', currency: 'usd', interval: 'month', unitAmount: 1900 } },
    installation,
  }
  const store = { claim: vi.fn<ScheduledPlanChangeInstallationStore['claim']>().mockResolvedValue(initial),
    checkpoint: vi.fn<ScheduledPlanChangeInstallationStore['checkpoint']>(),
    finish: vi.fn<ScheduledPlanChangeInstallationStore['finish']>().mockResolvedValue(true) }
  let current = initial
  const calls: string[] = []
  store.checkpoint.mockImplementation(async (fence, step) => {
    expect(fence).toEqual(current.fence)
    calls.push(step.action)
    let next = current.installation
    switch (step.action) {
      case 'begin_attach': next = { stage: 'attach_requested', replayUntil }; break
      case 'record_attach': next = { stage: 'attached', scheduleId: step.scheduleId }; break
      case 'begin_configure': next = { stage: 'configure_requested', scheduleId, replayUntil }; break
    }
    current = { ...current, installation: next, fence: { ...fence, operationRevision: fence.operationRevision + 1 } }
    return current
  })
  const provider = {
    attach: vi.fn<Parameters<typeof installScheduledPlanChange>[0]['provider']['attach']>().mockImplementation(async request => {
      expect(request.idempotencyKey).toBe(`pika-plan-change-${operationId}-attach`)
      expect(request.replayUntil).toBe(replayUntil)
      if (!await request.beforeMutation()) return { kind: 'stale' }
      calls.push('stripe_attach')
      return { kind: 'attached', scheduleId }
    }),
    configure: vi.fn<Parameters<typeof installScheduledPlanChange>[0]['provider']['configure']>().mockImplementation(async request => {
      expect(request.idempotencyKey).toBe(`pika-plan-change-${operationId}-configure`)
      expect(request.operation.scheduleId).toBe(scheduleId)
      expect(request.replayUntil).toBe(replayUntil)
      if (!await request.beforeMutation()) return { kind: 'stale' }
      calls.push('stripe_configure')
      return { kind: 'configured', scheduleId }
    }),
  }
  const run = (now = '2026-11-09T00:00:00Z', providerMode: 'test' | 'live' = 'test') => installScheduledPlanChange({ operationId, stripeAccount: 'acct_billing',
    store, provider, providerMode, now: () => Date.parse(now) })
  return { store, provider, calls, run, initial }
}

describe('scheduled change installation orchestration', () => {
  it('records each possible write and durably captures the attached schedule before configuration', async () => {
    const { run, calls, store } = fixture()
    await expect(run()).resolves.toBe('installed')
    expect(calls).toEqual(['begin_attach', 'authorize_write', 'stripe_attach', 'record_attach',
      'begin_configure', 'authorize_write', 'stripe_configure'])
    expect(store.finish).toHaveBeenCalledWith(expect.objectContaining({ operationRevision: 8 }),
      { outcome: 'installed', scheduleId })
  })

  it('does not write after a lease is lost inside a provider read', async () => {
    const { run, calls, store, provider } = fixture({ stage: 'attach_requested', replayUntil })
    store.checkpoint.mockResolvedValueOnce(null)
    await expect(run()).resolves.toBe('lost_claim')
    expect(calls).toEqual([])
    expect(provider.configure).not.toHaveBeenCalled()
    expect(store.finish).not.toHaveBeenCalled()
  })

  it('keeps the persisted configure deadline when Stripe times out', async () => {
    const { run, store, calls, provider } = fixture({ stage: 'configure_requested', scheduleId, replayUntil })
    provider.configure.mockRejectedValueOnce(new Error('Response lost'))
    await expect(run()).resolves.toBe('retry')
    expect(calls).toEqual([])
    expect(provider.configure).toHaveBeenCalledWith(expect.objectContaining({ replayUntil }))
    expect(provider.attach).not.toHaveBeenCalled()
    expect(store.finish).toHaveBeenCalledWith(expect.any(Object), { outcome: 'retry' })
  })

  it('quarantines unresolved provider evidence after a possible write', async () => {
    const { run, store, provider } = fixture({ stage: 'attach_requested', replayUntil })
    provider.attach.mockRejectedValueOnce(new StripePlanChangeContractError())
    await expect(run(effectiveAt)).resolves.toBe('attention')
    expect(store.finish).toHaveBeenCalledWith(expect.any(Object), { outcome: 'attention' })
  })

  it('allows a later read when the attachment event has not appeared yet', async () => {
    const { run, store, provider } = fixture({ stage: 'attach_requested', replayUntil })
    provider.attach.mockRejectedValueOnce(new StripePlanChangeCreationEvidencePending())
    await expect(run()).resolves.toBe('retry')
    expect(store.checkpoint).not.toHaveBeenCalled()
    expect(store.finish).toHaveBeenCalledWith(expect.any(Object), { outcome: 'retry' })
  })

  it('expires untouched intent at the boundary without calling Stripe', async () => {
    const { run, store, provider } = fixture()
    await expect(run(effectiveAt)).resolves.toBe('expired')
    expect(provider.attach).not.toHaveBeenCalled()
    expect(store.finish).toHaveBeenCalledWith(expect.any(Object), { outcome: 'expired' })
  })
})

describe('live scheduled installation pause and identity', () => {
  it.each(['begin_attach', 'authorize_write', 'begin_configure'] as const)('defers a refused %s with the current fence', async action => {
    const f = fixture(action === 'begin_attach' ? { stage: 'confirmed' } : action === 'begin_configure'
      ? { stage: 'attached', scheduleId } : { stage: 'attach_requested', replayUntil })
    f.initial.operation.providerMode = 'live'; f.initial.operation.lastPaidInvoiceId = 'in_paid'
    f.store.checkpoint.mockResolvedValueOnce(null)
    expect(await f.run(undefined, 'live')).toBe('deferred')
    expect(f.store.finish).toHaveBeenCalledWith(f.initial.fence, { outcome: 'deferred' })
  })
  it('keeps stale behavior if the database rejects deferral and preserves live invoice identity', async () => {
    const f = fixture({ stage: 'attach_requested', replayUntil })
    f.initial.operation.providerMode = 'live'; f.initial.operation.lastPaidInvoiceId = 'in_paid'
    f.store.checkpoint.mockResolvedValueOnce(null); f.store.finish.mockResolvedValueOnce(false)
    expect(await f.run(undefined, 'live')).toBe('lost_claim')
    expect(f.provider.attach.mock.calls[0][0].operation).toHaveProperty('providerMode', 'live')
    expect(f.provider.attach.mock.calls[0][0].operation).toHaveProperty('lastPaidInvoiceId', 'in_paid')
  })
  it('refuses cross-mode or malformed live claims before provider reads', async () => {
    const f = fixture()
    await expect(f.run(undefined, 'live')).rejects.toThrow('Invalid scheduled change claim')
    f.initial.operation.providerMode = 'live'; f.initial.operation.lastPaidInvoiceId = 'bad'
    await expect(f.run(undefined, 'live')).rejects.toThrow('Invalid scheduled change claim')
    expect(f.provider.attach).not.toHaveBeenCalled()
  })
})
