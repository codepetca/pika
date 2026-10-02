import { describe, expect, it, vi } from 'vitest'
import { createBillingCloseoutStore } from '@/lib/server/billing/closeout-store'

describe('closeout database seam', () => {
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
