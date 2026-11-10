import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBillingPortalRuntime } from '@/lib/server/billing/portal-runtime'

const mocks = vi.hoisted(() => {
  const get = vi.fn(); const eq = vi.fn(); const abortSignal = vi.fn(); const select = vi.fn(); const from = vi.fn()
  const rpcAbort = vi.fn(); const rpc = vi.fn(); const client = { from, rpc }
  const account = vi.fn(); const customer = vi.fn(); const configuration = vi.fn(); const session = vi.fn()
  return { get, eq, abortSignal, select, from, rpcAbort, rpc, client, account, customer, configuration, session }
})
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mocks.client) }))
vi.mock('@/lib/server/supabase-target', () => ({ createTargetBoundFetch: vi.fn(() => vi.fn()) }))
vi.mock('stripe', () => ({ default: class {
  accounts = { retrieve: mocks.account }
  customers = { retrieve: mocks.customer }
  billingPortal = { configurations: { retrieve: mocks.configuration }, sessions: { create: mocks.session } }
} }))

const userId = '2a41e3d8-4ee2-4426-987f-d7468d2fd9d7'
const target = { providerMode: 'live' as const, projectRef: 'zhioqbapgfcrronyuidm', stripeAccount: 'acct_live',
  supabaseOrigin: 'https://zhioqbapgfcrronyuidm.supabase.co', appOrigin: 'https://pika.codepet.ca' as const,
  secretKey: 'sk_live_Fixture', workerSecret: 'worker', checkoutAdmissionEnabled: false, providerWritesEnabled: false }

beforeEach(() => {
  vi.clearAllMocks()
  const chain = { select: mocks.select, eq: mocks.eq, abortSignal: mocks.abortSignal, maybeSingle: mocks.get }
  mocks.from.mockReturnValue(chain); mocks.select.mockReturnValue(chain); mocks.eq.mockReturnValue(chain); mocks.abortSignal.mockReturnValue(chain)
  mocks.rpc.mockReturnValue({ abortSignal: mocks.rpcAbort }); mocks.rpcAbort.mockResolvedValue({ data: true, error: null })
  mocks.get.mockResolvedValue({ data: { subject_user_id: userId, stripe_account: 'acct_live', provider_mode: 'live', stripe_customer_id: 'cus_live' }, error: null })
  mocks.account.mockResolvedValue({ id: 'acct_live' }); mocks.customer.mockResolvedValue({ id: 'cus_live', livemode: true })
  mocks.configuration.mockResolvedValue({ id: 'bpc_live', object: 'billing_portal.configuration', active: true, livemode: true, features: {
    customer_update: { enabled: false }, invoice_history: { enabled: true }, payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end', proration_behavior: 'none' }, subscription_update: { enabled: false },
  } })
  mocks.session.mockResolvedValue({ object: 'billing_portal.session', configuration: 'bpc_live', customer: 'cus_live', livemode: true,
    return_url: 'https://pika.codepet.ca/billing', url: 'https://billing.stripe.com/p/live', flow: null })
})

describe('live portal runtime', () => {
  it('checks the exact lifecycle target and queries only its live customer binding', async () => {
    await expect(createBillingPortalRuntime(target, 'bpc_live').open(userId)).resolves.toBe('https://billing.stripe.com/p/live')
    expect(mocks.rpc).toHaveBeenCalledWith('billing_live_payment_lifecycle_ready_v1', { p_project_ref: target.projectRef, p_stripe_account: 'acct_live' })
    expect(mocks.eq.mock.calls).toEqual([['subject_user_id', userId], ['stripe_account', 'acct_live'], ['provider_mode', 'live']])
    expect(mocks.customer).toHaveBeenCalledWith('cus_live')
  })
  it.each([{ data: false, error: null }, { data: null, error: { code: 'fault' } }, { data: 'true', error: null }])('fails closed when lifecycle evidence is unavailable %#', async response => {
    mocks.rpcAbort.mockResolvedValueOnce(response)
    await expect(createBillingPortalRuntime(target, 'bpc_live').open(userId)).rejects.toThrow('Portal unavailable')
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.session).not.toHaveBeenCalled()
  })
})
