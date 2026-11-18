import { beforeEach, describe, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ rpc: vi.fn(), abort: vi.fn(), process: vi.fn(), provider: vi.fn(), reader: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: m.rpc }) }))
vi.mock('@/lib/server/supabase-target', () => ({ createTargetBoundFetch: () => vi.fn() }))
vi.mock('@/lib/server/billing/runtime', () => ({ createBillingStripeClient: () => ({}), createStripeBillingReadPort: () => ({}) }))
vi.mock('@/lib/server/billing/stripe-provider', () => ({ createStripeBillingProvider: m.reader }))
vi.mock('@/lib/server/billing/stripe-plan-change-provider', () => ({ createStripePlanChangePort: () => ({}), createLiveScheduledCancellationProvider: m.provider }))
vi.mock('@/lib/server/billing/scheduled-cancellation-service', async () => {
  const { z } = await import('zod')
  return { cancellationClaimSchema: z.unknown(), processScheduledCancellation: m.process }
})
import { processLiveScheduledCancellations, createLiveScheduledCancellationRpc } from '@/lib/server/billing/scheduled-cancellation-runtime'
const config = { providerMode: 'live' as const, stripeAccount: 'acct_live', projectRef: 'project',
  supabaseOrigin: 'https://project.supabase.co', appOrigin: 'https://pika.codepet.ca' as const, secretKey: 'rk_live_fixture',
  checkoutAdmissionEnabled: false, providerWritesEnabled: false }
beforeEach(() => { vi.resetAllMocks(); m.rpc.mockReturnValue({ abortSignal: m.abort }); m.abort.mockResolvedValue({ data: [], error: null });
  m.provider.mockReturnValue({}); m.reader.mockReturnValue({ retrieveSubscription: vi.fn() }) })
describe('live scheduled cancellation runtime', () => {
  it('pins RPC target, limits work and applies an abort signal', async () => {
    expect(await processLiveScheduledCancellations(config, 1)).toEqual({})
    expect(m.rpc).toHaveBeenCalledWith('billing_list_live_scheduled_cancellations_v1', { p_project_ref: 'project',
      p_stripe_account: 'acct_live', p_request: { limit: 1 } })
    expect(m.abort.mock.calls[0][0]).toBeInstanceOf(AbortSignal)
    await expect(processLiveScheduledCancellations(config, 6)).rejects.toThrow()
  })
  it('passes the exact fenced command envelopes through the scoped RPC', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    const fence = { operationId: id, subscriptionId: id, leaseToken: id, fencingToken: 1, subscriptionRevision: 1, operationRevision: 1 }
    m.abort.mockResolvedValueOnce({ data: [id], error: null }).mockResolvedValueOnce({ data: { fence }, error: null })
      .mockResolvedValueOnce({ data: { fence }, error: null }).mockResolvedValueOnce({ data: true, error: null })
    m.process.mockImplementation(async input => { const current = await input.store.claim(id)
      await input.store.authorize(current.fence); await input.store.finish(current.fence, 'deferred'); return 'deferred' })
    expect(await processLiveScheduledCancellations(config)).toEqual({ deferred: 1 })
    const target = { p_project_ref: 'project', p_stripe_account: 'acct_live' }
    expect(m.rpc.mock.calls.slice(1)).toEqual([
      ['billing_live_scheduled_cancellation_command_v1', { ...target, p_request: { operation_id: id, action: 'claim' } }],
      ['billing_live_scheduled_cancellation_command_v1', { ...target, p_request: { operation_id: id, action: 'authorize_write', fence } }],
      ['billing_live_scheduled_cancellation_command_v1', { ...target, p_request: { operation_id: id, action: 'finish', fence, outcome: 'deferred' } }],
    ])
    expect(m.abort).toHaveBeenCalledTimes(4)
  })
  it('rejects wrong mode and propagates database failure', async () => {
    expect(() => createLiveScheduledCancellationRpc({ ...config, providerMode: 'test' as 'live' })).toThrow()
    m.abort.mockResolvedValue({ data: null, error: { code: 'offline' } })
    await expect(processLiveScheduledCancellations(config)).rejects.toThrow()
  })
})
