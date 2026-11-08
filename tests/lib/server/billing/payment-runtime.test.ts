import { beforeEach, describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), response: vi.fn(), checkout: vi.fn(), reconcile: vi.fn(), provision: vi.fn(), diagnostics: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mock.rpc }) }))
vi.mock('@/lib/server/billing/purchase-runtime', () => ({ createBillingPurchaseRuntime: () => ({ reconcileCheckouts: mock.checkout }) }))
vi.mock('@/lib/server/billing/runtime', () => ({ reconcileLiveBillingSubscriptions: mock.reconcile }))
vi.mock('@/lib/server/repolight-provision-runtime', () => ({ attemptRepoLightProvisionOutbox: mock.provision }))
vi.mock('@/lib/server/diagnostics', () => ({ logServerError: mock.diagnostics }))

import { processLiveBillingPaymentLifecycle } from '@/lib/server/billing/payment-runtime'

const config = {
  providerMode: 'live', appOrigin: 'https://pika.codepet.ca', projectRef: 'zhioqbapgfcrronyuidm',
  stripeAccount: 'acct_LiveWorkerFixture', supabaseOrigin: 'https://zhioqbapgfcrronyuidm.supabase.co',
  secretKey: 'rk_live_Fixture', checkoutAdmissionEnabled: false, providerWritesEnabled: false,
} as const
const scope = { p_project_ref: config.projectRef, p_stripe_account: config.stripeAccount }

beforeEach(() => {
  vi.resetAllMocks()
  mock.rpc.mockReturnValue({ abortSignal: mock.response })
  mock.response.mockResolvedValueOnce({ data: true, error: null })
    .mockResolvedValueOnce({ data: { processed: 1 }, error: null })
  mock.checkout.mockResolvedValue({ processed: 1, failed: 0 })
  mock.reconcile.mockResolvedValue({ applied: 1 })
  mock.diagnostics.mockReturnValue('payment-diagnostic')
})

describe('live paid billing recovery', () => {
  it('does no recovery work when the exact database target is unavailable', async () => {
    mock.response.mockReset().mockResolvedValueOnce({ data: false, error: null })
    await expect(processLiveBillingPaymentLifecycle(config)).rejects.toMatchObject({ statusCode: 503 })
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('billing_live_payment_lifecycle_ready_v1', scope)
    expect(mock.checkout).not.toHaveBeenCalled()
    expect(mock.reconcile).not.toHaveBeenCalled()
    expect(mock.provision).not.toHaveBeenCalled()
  })

  it('checks purchase recovery and invoice evidence before applying due access and RepoLight effects', async () => {
    await expect(processLiveBillingPaymentLifecycle(config)).resolves.toEqual({
      purchases: { processed: 1, failed: 0 }, reconciliation: { applied: 1 }, expiry: { processed: 1 },
    })
    expect(mock.checkout).toHaveBeenCalledBefore(mock.reconcile)
    expect(mock.reconcile.mock.invocationCallOrder[0]).toBeLessThan(mock.rpc.mock.invocationCallOrder[1])
    expect(mock.rpc).toHaveBeenLastCalledWith('billing_apply_due_live_paid_access_v1', { ...scope, p_request: { limit: 25 } })
    expect(mock.rpc.mock.invocationCallOrder[1]).toBeLessThan(mock.provision.mock.invocationCallOrder[0])
  })

  it('preserves exact-cutoff expiry and RepoLight recovery if Stripe reconciliation fails', async () => {
    mock.reconcile.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(processLiveBillingPaymentLifecycle(config)).resolves.toMatchObject({
      reconciliation: { failed: 1, diagnosticId: 'payment-diagnostic' }, expiry: { processed: 1 },
    })
    expect(mock.provision).toHaveBeenCalledOnce()
  })
})
