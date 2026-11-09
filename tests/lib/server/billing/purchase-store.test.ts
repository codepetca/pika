import { describe, expect, it, vi } from 'vitest'
import { CheckoutEligibilityError } from '@/lib/server/billing/checkout-contracts'
import { createBillingPurchaseStore, createLiveBillingPurchaseStore } from '@/lib/server/billing/purchase-store'

describe('purchase database errors', () => {
  it('exposes only the recognized reservation eligibility denial as a domain error', async () => {
    const store = createBillingPurchaseStore({ rpc: vi.fn().mockResolvedValue({
      data: null, error: { code: '55000', message: 'checkout_account_plan_ineligible', details: 'private details' },
    }) })
    await expect(store.reserveCheckout({} as Parameters<typeof store.reserveCheckout>[0]))
      .rejects.toBeInstanceOf(CheckoutEligibilityError)
  })
  it('keeps arbitrary database details private and does not translate other operations', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'private database information' } })
    const store = createBillingPurchaseStore({ rpc })
    await expect(store.getCheckout({ subject_user_id: 'user', attempt_id: 'attempt' }))
      .rejects.toThrow('Billing purchase database operation failed')
    rpc.mockResolvedValue({ data: null, error: { message: 'checkout_account_plan_ineligible' } })
    await expect(store.getCheckout({ subject_user_id: 'user', attempt_id: 'attempt' }))
      .rejects.not.toBeInstanceOf(CheckoutEligibilityError)
  })
})

describe('live checkout database scope', () => {
  const target = { projectRef: 'zhioqbapgfcrronyuidm', stripeAccount: 'acct_LivePurchase' }
  const fence = { attempt_id: 'attempt', lease_token: 'lease', fencing_token: 1 }

  it('uses only scoped RPCs for reads, writes, and non-consuming pause', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null })
    const store = createLiveBillingPurchaseStore({ rpc }, target)
    await store.listCheckoutWork({ limit: 2 })
    await expect(store.authorizeProviderWrite(fence)).resolves.toBe(false)
    await store.finishCheckout({ ...fence, outcome: 'paused', reason_code: 'provider_writes_paused' })
    const scope = { p_project_ref: target.projectRef, p_stripe_account: target.stripeAccount }
    expect(rpc.mock.calls).toEqual([
      ['billing_list_live_checkout_work_v1', { ...scope, p_request: { limit: 2 } }],
      ['billing_authorize_live_checkout_write_v1', { ...scope, p_request: fence }],
      ['billing_finish_live_checkout_v1', { ...scope, p_request: { ...fence, outcome: 'paused', reason_code: 'provider_writes_paused' } }],
    ])
  })

  it('rejects ambiguous write authorization', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { allowed: true }, error: null })
    const store = createLiveBillingPurchaseStore({ rpc }, target)
    await expect(store.authorizeProviderWrite(fence)).rejects.toThrow('Live checkout write authorization unavailable')
    rpc.mockResolvedValue({ data: true, error: { message: 'private database detail' } })
    await expect(store.authorizeProviderWrite(fence)).rejects.toThrow('Live checkout write authorization unavailable')
  })
})
