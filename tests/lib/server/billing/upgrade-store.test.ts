import { describe, expect, it, vi } from 'vitest'
import { createBillingUpgradeStore } from '@/lib/server/billing/upgrade-store'

describe('upgrade database adapter', () => {
  it.each([
    ['reserve', 'billing_reserve_upgrade_v1'], ['get', 'billing_get_upgrade_v1'],
    ['list', 'billing_list_upgrades_v1'], ['claim', 'billing_claim_upgrade_v1'],
    ['checkpoint', 'billing_checkpoint_upgrade_v1'], ['confirm', 'billing_confirm_upgrade_v1'],
    ['finish', 'billing_finish_upgrade_v1'], ['getApplied', 'billing_get_applied_upgrade_v1'],
  ] as const)('passes %s request through the exact RPC seam', async (method, rpcName) => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: 'found' }, error: null })
    const store = createBillingUpgradeStore({ rpc })
    const request = { operation_id: 'fixture' }
    expect(await store[method](request as never)).toEqual({ status: 'found' })
    expect(rpc).toHaveBeenCalledExactlyOnceWith(rpcName, { p_request: request })
  })
  it('keeps the actual sandbox SQL error private', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null,
      error: { code: '55000', message: 'stripe_billing_sandbox_disabled', details: 'private' } })
    const store = createBillingUpgradeStore({ rpc })
    await expect(store.reserve({} as never)).rejects.toThrow('Billing upgrade database operation failed')
    await expect(store.get({} as never)).rejects.toThrow('Billing upgrade database operation failed')
  })
  it('keeps the actual quote-validation SQL error private', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null,
      error: { code: '22023', message: 'billing_upgrade_quote_invalid', details: 'private' } })
    const store = createBillingUpgradeStore({ rpc })
    await expect(store.confirm({} as never)).rejects.toThrow('Billing upgrade database operation failed')
    await expect(store.reserve({} as never)).rejects.toThrow('Billing upgrade database operation failed')
  })
  it.each([{ code: '22023', message: 'billing_upgrade_request_invalid' },
    { code: '55000', message: 'private backend details' }, { message: 'billing_upgrade_ineligible' }])(
    'keeps unrecognized database errors private %#', async error => {
      const store = createBillingUpgradeStore({ rpc: vi.fn().mockResolvedValue({ data: null, error }) })
      await expect(store.reserve({} as never)).rejects.toThrow('Billing upgrade database operation failed')
    },
  )
})
