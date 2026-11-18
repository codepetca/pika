import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), abort: vi.fn(), install: vi.fn(), provider: vi.fn() }))
vi.mock('stripe', () => ({ default: class Stripe {} }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/server/supabase-target', () => ({ createTargetBoundFetch: () => vi.fn() }))
vi.mock('@/lib/server/billing/runtime', () => ({ STRIPE_BILLING_API_VERSION: 'fixture' }))
vi.mock('@/lib/server/billing/stripe-plan-change-provider', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/billing/stripe-plan-change-provider')>(),
  createStripePlanChangePort: () => ({}), createStripePlanChangeProvider: mocks.provider,
}))
vi.mock('@/lib/server/billing/scheduled-plan-change-service', () => ({ installScheduledPlanChange: mocks.install }))
import { createLiveScheduledPlanChangeRuntime } from '@/lib/server/billing/scheduled-plan-change-runtime'

const config = { providerMode: 'live' as const, projectRef: 'zhioqbapgfcrronyuidm', stripeAccount: 'acct_Live',
  supabaseOrigin: 'https://zhioqbapgfcrronyuidm.supabase.co', appOrigin: 'https://pika.codepet.ca' as const,
  secretKey: 'rk_live_fixture', checkoutAdmissionEnabled: false, providerWritesEnabled: false }
const id = '817e28b2-b87f-4de9-b395-548f96e7461a'
const claim = {
  fence: { operationId: id, subscriptionId: '11111111-1111-4111-8111-111111111111',
    leaseToken: '22222222-2222-4222-8222-222222222222', fencingToken: 1, subscriptionRevision: 1, operationRevision: 1 },
  operation: { operationId: id, stripeAccount: 'acct_Live', stripeCustomerId: 'cus_Live', stripeSubscriptionId: 'sub_Live',
    paidPeriodStart: '2026-10-20T00:00:00Z', effectiveAt: '2026-11-20T00:00:00Z', providerMode: 'live', lastPaidInvoiceId: 'in_Paid',
    source: { priceId: 'price_Max', productId: 'prod_Max', currency: 'usd', interval: 'month', unitAmount: 3900 },
    target: { priceId: 'price_Pro', productId: 'prod_Pro', currency: 'usd', interval: 'month', unitAmount: 1900 } },
  installation: { stage: 'confirmed' },
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.provider.mockReturnValue({})
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abort })
  mocks.abort.mockResolvedValue({ data: [], error: null })
})

describe('live scheduled change runtime', () => {
  it('binds provider scope and uses bounded exact RPC envelopes for claim, checkpoint and finish', async () => {
    mocks.abort.mockResolvedValueOnce({ data: [id], error: null })
      .mockResolvedValueOnce({ data: claim, error: null })
      .mockResolvedValueOnce({ data: claim, error: null })
      .mockResolvedValueOnce({ data: true, error: null })
    mocks.install.mockImplementation(async input => {
      expect(input.providerMode).toBe('live')
      expect(input.stripeAccount).toBe(config.stripeAccount)
      const got = await input.store.claim(id)
      expect(got.operation.lastPaidInvoiceId).toBe('in_Paid')
      await input.store.checkpoint(got.fence, { action: 'record_attach', scheduleId: 'sub_sched_Live' })
      await input.store.finish(got.fence, { outcome: 'deferred' })
      return 'deferred'
    })
    expect(await createLiveScheduledPlanChangeRuntime(config).processDue({ limit: 2 })).toEqual({ deferred: 1 })
    expect(mocks.provider).toHaveBeenCalledWith(expect.anything(), expect.any(Function), { providerMode: 'live', stripeAccount: 'acct_Live' })
    const target = { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount }
    expect(mocks.rpc.mock.calls).toEqual([
      ['billing_list_live_scheduled_installations_v1', { ...target, p_request: { limit: 2 } }],
      ['billing_live_scheduled_installation_command_v1', { ...target, p_request: { operation_id: id, action: 'claim' } }],
      ['billing_live_scheduled_installation_command_v1', { ...target, p_request: { operation_id: id, action: 'record_attach', fence: claim.fence, schedule_id: 'sub_sched_Live' } }],
      ['billing_live_scheduled_installation_command_v1', { ...target, p_request: { operation_id: id, action: 'deferred', fence: claim.fence } }],
    ])
    expect(mocks.abort).toHaveBeenCalledTimes(4)
    for (const [signal] of mocks.abort.mock.calls) expect(signal).toBeInstanceOf(AbortSignal)
  })
  it('rejects invalid limits, oversized work lists and malformed live claims', async () => {
    const runtime = createLiveScheduledPlanChangeRuntime(config)
    await expect(runtime.processDue({ limit: 6 })).rejects.toThrow()
    expect(mocks.rpc).not.toHaveBeenCalled()
    mocks.abort.mockResolvedValueOnce({ data: [id, id], error: null })
    await expect(runtime.processDue({ limit: 1 })).rejects.toThrow()
    mocks.abort.mockResolvedValueOnce({ data: [id], error: null })
      .mockResolvedValueOnce({ data: { ...claim, operation: { ...claim.operation, providerMode: 'test' } }, error: null })
    mocks.install.mockImplementation(async input => input.store.claim(id))
    await expect(runtime.processDue({ limit: 1 })).rejects.toThrow()
  })
  it('surfaces RPC errors and rejects wrong provider modes before transport', async () => {
    expect(() => createLiveScheduledPlanChangeRuntime({ ...config, providerMode: 'test' as 'live' })).toThrow()
    mocks.abort.mockResolvedValueOnce({ data: null, error: { code: 'failed' } })
    await expect(createLiveScheduledPlanChangeRuntime(config).processDue({ limit: 1 })).rejects.toThrow()
  })
})
