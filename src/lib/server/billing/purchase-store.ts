import type { Json } from '@/types/database.generated'
import type { CheckoutStore } from '@/lib/server/billing/checkout-contracts'

type PurchaseRpcName =
  | 'billing_get_checkout_offering_v1' | 'billing_list_checkout_offerings_v1'
  | 'billing_reserve_checkout_v1' | 'billing_get_checkout_v1'
  | 'billing_list_checkout_work_v1' | 'billing_claim_checkout_v1'
  | 'billing_save_checkout_progress_v1' | 'billing_finish_checkout_v1'

export type PurchaseRpcClient = {
  rpc(name: PurchaseRpcName, args: { p_request: Json }): PromiseLike<{ data: unknown; error: unknown }>
}

export function createBillingPurchaseStore(client: PurchaseRpcClient): CheckoutStore & {
  listOfferings(input: { stripe_account: string }): Promise<unknown>
} {
  async function call(name: PurchaseRpcName, request: Json) {
    const { data, error } = await client.rpc(name, { p_request: request })
    if (error) throw new Error('Billing purchase database operation failed')
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
    finishCheckout: request => call('billing_finish_checkout_v1', request),
  }
}
