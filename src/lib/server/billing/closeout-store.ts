import type { Json } from '@/types/database.generated'
import type { RenewalCloseoutStore } from './closeout-contracts'

type CloseoutRpcName = 'billing_list_renewal_closeouts_v1' | 'billing_claim_renewal_closeout_v1'
  | 'billing_checkpoint_renewal_closeout_v1' | 'billing_finish_renewal_closeout_v1'
export type BillingCloseoutRpcClient = {
  rpc(name: CloseoutRpcName, args: { p_request: Json }): PromiseLike<{ data: unknown; error: unknown }>
}
export function createBillingCloseoutStore(client: BillingCloseoutRpcClient, scheduledChangesEnabled = false): RenewalCloseoutStore {
  async function call(name: CloseoutRpcName, request: Json): Promise<unknown> {
    const { data, error } = await client.rpc(name, { p_request: request })
    if (error) throw new Error('Billing closeout database operation failed')
    return data
  }
  return {
    listDue: input => call('billing_list_renewal_closeouts_v1', scheduledChangesEnabled ? { ...input, scheduled_changes_enabled: true } : input),
    claim: input => call('billing_claim_renewal_closeout_v1', scheduledChangesEnabled ? { ...input, scheduled_changes_enabled: true } : input),
    checkpoint: input => call('billing_checkpoint_renewal_closeout_v1', input),
    finish: input => call('billing_finish_renewal_closeout_v1', input),
  }
}

type LiveCloseoutRpcName = 'billing_list_live_renewal_closeouts_v1' | 'billing_claim_live_renewal_closeout_v1'
  | 'billing_checkpoint_live_renewal_closeout_v1' | 'billing_finish_live_renewal_closeout_v1'
export type LiveBillingCloseoutRpcClient = {
  rpc(name: LiveCloseoutRpcName, args: { p_project_ref: string; p_stripe_account: string; p_request: Json }):
    PromiseLike<{ data: unknown; error: unknown }>
}

export function createLiveBillingCloseoutStore(client: LiveBillingCloseoutRpcClient, target: {
  projectRef: string; stripeAccount: string
}, scheduledChangesEnabled = false): RenewalCloseoutStore {
  async function call(name: LiveCloseoutRpcName, payload: Json) {
    const { data, error } = await client.rpc(name, {
      p_project_ref: target.projectRef, p_stripe_account: target.stripeAccount, p_request: payload,
    })
    if (error) throw new Error('Live renewal closeout is unavailable')
    return data
  }
  return {
    listDue: input => call('billing_list_live_renewal_closeouts_v1', scheduledChangesEnabled ? { ...input, scheduled_changes_enabled: true } : input),
    claim: input => call('billing_claim_live_renewal_closeout_v1', scheduledChangesEnabled ? { ...input, scheduled_changes_enabled: true } : input),
    checkpoint: input => call('billing_checkpoint_live_renewal_closeout_v1', input),
    finish: input => call('billing_finish_live_renewal_closeout_v1', input),
  }
}
