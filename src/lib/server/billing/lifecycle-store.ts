import type { Json } from '@/types/database.generated'
import { BillingLifecycleEligibilityError, type BillingLifecycleStore } from './lifecycle-service'

type LifecycleRpcName = 'billing_start_trial_v1' | 'billing_get_access_status_v1' | 'billing_apply_due_access_v1'
export type BillingLifecycleRpcClient = {
  rpc(name: LifecycleRpcName, args: { p_request: Json }): PromiseLike<{ data: unknown; error: unknown }>
}
export function createBillingLifecycleStore(client: BillingLifecycleRpcClient): BillingLifecycleStore {
  async function call(name: LifecycleRpcName, request: Json): Promise<unknown> {
    const { data, error } = await client.rpc(name, { p_request: request })
    if (error) {
      if (name === 'billing_start_trial_v1' && typeof error === 'object' && 'code' in error && error.code === '55000'
        && 'message' in error && error.message === 'billing_trial_ineligible') throw new BillingLifecycleEligibilityError()
      throw new Error('Billing lifecycle database operation failed')
    }
    return data
  }
  return {
    startTrial: input => call('billing_start_trial_v1', input),
    getAccessStatus: input => call('billing_get_access_status_v1', input),
    applyDueAccess: input => call('billing_apply_due_access_v1', input),
  }
}
