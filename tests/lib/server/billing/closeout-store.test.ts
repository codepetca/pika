import { describe, expect, it, vi } from 'vitest'
import { createBillingCloseoutStore, createLiveBillingCloseoutStore } from '@/lib/server/billing/closeout-store'

describe('closeout database seam', () => {
  it('opts the exact live worker into scheduled closeout without changing the default RPC requests', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'busy' }, error: null })
    const target = { projectRef: 'abcdefghijklmnopqrst', stripeAccount: 'acct_Live' }
    const scope = { p_project_ref: target.projectRef, p_stripe_account: target.stripeAccount }
    const claim = { subscription_id: 'id', lease_seconds: 120 }
    await createLiveBillingCloseoutStore({ rpc }, target).listDue({ limit: 1 })
    const store = createLiveBillingCloseoutStore({ rpc }, target, true)
    await store.listDue({ limit: 1 })
    await store.claim(claim)
    expect(rpc.mock.calls).toEqual([
      ['billing_list_live_renewal_closeouts_v1', { ...scope, p_request: { limit: 1 } }],
      ['billing_list_live_renewal_closeouts_v1', { ...scope, p_request: { limit: 1, scheduled_changes_enabled: true } }],
      ['billing_claim_live_renewal_closeout_v1', { ...scope, p_request: { ...claim, scheduled_changes_enabled: true } }],
    ])
  })

  it('opts the list and claim into scheduled work only when the worker is enabled', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'busy' }, error: null })
    const store = createBillingCloseoutStore({ rpc }, true)
    await store.listDue({ limit: 1 })
    await store.claim({ subscription_id: 'id', lease_seconds: 120 })
    expect(rpc.mock.calls).toEqual([
      ['billing_list_renewal_closeouts_v1', { p_request: { limit: 1, scheduled_changes_enabled: true } }],
      ['billing_claim_renewal_closeout_v1', { p_request: { subscription_id: 'id', lease_seconds: 120, scheduled_changes_enabled: true } }],
    ])
  })
  it('uses only the service RPCs with structured requests', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'busy' }, error: null })
    const store = createBillingCloseoutStore({ rpc })
    await store.listDue({ limit: 1 }); await store.claim({ subscription_id: 'id', lease_seconds: 120 })
    expect(rpc.mock.calls).toEqual([
      ['billing_list_renewal_closeouts_v1', { p_request: { limit: 1 } }],
      ['billing_claim_renewal_closeout_v1', { p_request: { subscription_id: 'id', lease_seconds: 120 } }],
    ])
  })
  it('does not expose database error payloads', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'private secret' } })
    await expect(createBillingCloseoutStore({ rpc }).listDue({ limit: 1 })).rejects.toThrow('Billing closeout database operation failed')
  })
})
