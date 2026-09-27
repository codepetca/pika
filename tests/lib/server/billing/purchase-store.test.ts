import { describe, expect, it, vi } from 'vitest'
import { CheckoutEligibilityError } from '@/lib/server/billing/checkout-contracts'
import { createBillingPurchaseStore } from '@/lib/server/billing/purchase-store'

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
