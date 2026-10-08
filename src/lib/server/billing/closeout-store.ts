import type { Json } from '@/types/database.generated'
import type { RenewalCloseoutStore } from './closeout-contracts'

type CloseoutRpcName = 'billing_list_renewal_closeouts_v1' | 'billing_claim_renewal_closeout_v1'
  | 'billing_checkpoint_renewal_closeout_v1' | 'billing_finish_renewal_closeout_v1'
export type BillingCloseoutRpcClient = {
  rpc(name: CloseoutRpcName, args: { p_request: Json }): PromiseLike<{ data: unknown; error: unknown }>
}
export function createBillingCloseoutStore(client: BillingCloseoutRpcClient): RenewalCloseoutStore {
  async function call(name: CloseoutRpcName, request: Json): Promise<unknown> {
    const { data, error } = await client.rpc(name, { p_request: request })
    if (error) throw new Error('Billing closeout database operation failed')
    return data
  }
  return {
    listDue: input => call('billing_list_renewal_closeouts_v1', input),
    claim: input => call('billing_claim_renewal_closeout_v1', input),
    checkpoint: input => call('billing_checkpoint_renewal_closeout_v1', input),
    finish: input => call('billing_finish_renewal_closeout_v1', input),
  }
}
