import { ApiError } from '@/lib/api-error'
import type { Json } from '@/types/database.generated'
import { CheckoutEligibilityError, type CheckoutFence, type CheckoutStore } from '@/lib/server/billing/checkout-contracts'

type PurchaseRpcName =
  | 'billing_get_checkout_offering_v1' | 'billing_list_checkout_offerings_v1'
  | 'billing_reserve_checkout_v1' | 'billing_get_checkout_v1'
  | 'billing_list_checkout_work_v1' | 'billing_claim_checkout_v1'
  | 'billing_save_checkout_progress_v1' | 'billing_finish_checkout_v1'

export type PurchaseRpcClient = {
  rpc(name: PurchaseRpcName, args: { p_request: Json }): PromiseLike<{ data: unknown; error: unknown }>
}

type PurchaseStore = CheckoutStore & {
  listOfferings(input: { stripe_account: string }): Promise<unknown>
}

function purchaseStore(request: (name: PurchaseRpcName, payload: Json) => PromiseLike<{
  data: unknown; error: unknown
}>, live: boolean): PurchaseStore {
  async function call(name: PurchaseRpcName, payload: Json) {
    const { data, error } = await request(name, payload)
    if (error) {
      if (typeof error === 'object' && 'code' in error && error.code === '55000' && 'message' in error) {
        if (name === 'billing_reserve_checkout_v1' && error.message === 'checkout_account_plan_ineligible') {
          throw new CheckoutEligibilityError()
        }
        if (live && name === 'billing_reserve_checkout_v1') {
          if (error.message === 'billing_live_checkout_admission_unavailable' || error.message === 'billing_live_checkout_activation_unavailable') {
            throw new CheckoutEligibilityError('New checkout is currently unavailable')
          }
          if (error.message === 'billing_live_checkout_future_releases') {
            throw new CheckoutEligibilityError('Resolve existing assignment schedules before starting checkout.')
          }
        }
        if (live && error.message === 'billing_live_payment_lifecycle_unavailable') {
          throw new ApiError(503, 'Live billing is unavailable')
        }
      }
      throw new Error('Billing purchase database operation failed')
    }
    return data
  }
  return {
    getCheckoutOffering: request => call('billing_get_checkout_offering_v1', request),
    listOfferings: request => call('billing_list_checkout_offerings_v1', request),
    reserveCheckout: request => call('billing_reserve_checkout_v1', request),
    getCheckout: request => call('billing_get_checkout_v1', request),
    listCheckoutWork: request => call('billing_list_checkout_work_v1', request),
    claimCheckout: request => call('billing_claim_checkout_v1', request),
    saveCheckoutProgress: request => call('billing_save_checkout_progress_v1', request),
    async finishCheckout(request) {
      if (!live && request.outcome === 'paused') throw new Error('Paused checkout requires a live scoped store')
      return call('billing_finish_checkout_v1', request)
    },
  }
}

export function createBillingPurchaseStore(client: PurchaseRpcClient): PurchaseStore {
  return purchaseStore((name, payload) => client.rpc(name, { p_request: payload }), false)
}

const livePurchaseRpcNames = {
  billing_get_checkout_offering_v1: 'billing_get_live_checkout_offering_v1',
  billing_list_checkout_offerings_v1: 'billing_list_live_checkout_offerings_v1',
  billing_reserve_checkout_v1: 'billing_reserve_live_checkout_v1',
  billing_get_checkout_v1: 'billing_get_live_checkout_v1',
  billing_list_checkout_work_v1: 'billing_list_live_checkout_work_v1',
  billing_claim_checkout_v1: 'billing_claim_live_checkout_v1',
  billing_save_checkout_progress_v1: 'billing_save_live_checkout_progress_v1',
  billing_finish_checkout_v1: 'billing_finish_live_checkout_v1',
} as const satisfies Record<PurchaseRpcName, string>

type LivePurchaseRpcName = (typeof livePurchaseRpcNames)[PurchaseRpcName] | 'billing_authorize_live_checkout_write_v1'
export type LivePurchaseRpcClient = {
  rpc(name: LivePurchaseRpcName, args: { p_project_ref: string; p_stripe_account: string; p_request: Json }):
    PromiseLike<{ data: unknown; error: unknown }>
}

export function createLiveBillingPurchaseStore(client: LivePurchaseRpcClient, target: {
  projectRef: string; stripeAccount: string
}): PurchaseStore & { authorizeProviderWrite(fence: CheckoutFence): Promise<boolean> } {
  const request = (name: LivePurchaseRpcName, payload: Json) => client.rpc(name, {
    p_project_ref: target.projectRef, p_stripe_account: target.stripeAccount, p_request: payload,
  })
  return {
    ...purchaseStore((name, payload) => request(livePurchaseRpcNames[name], payload), true),
    async authorizeProviderWrite(fence) {
      const { data, error } = await request('billing_authorize_live_checkout_write_v1', fence)
      if (error || typeof data !== 'boolean') throw new Error('Live checkout write authorization unavailable')
      return data
    },
  }
}
