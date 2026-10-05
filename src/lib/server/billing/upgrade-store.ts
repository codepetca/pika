import type { Json } from '@/types/database.generated'
import type { UpgradeStore } from './upgrade-contracts'

type UpgradeRpcName = 'billing_reserve_upgrade_v1' | 'billing_get_upgrade_v1' | 'billing_list_upgrades_v1'
  | 'billing_claim_upgrade_v1' | 'billing_checkpoint_upgrade_v1' | 'billing_confirm_upgrade_v1'
  | 'billing_finish_upgrade_v1' | 'billing_get_applied_upgrade_v1'
export type UpgradeRpcClient = {
  rpc(name: UpgradeRpcName, args: { p_request: Json }): PromiseLike<{ data: unknown; error: unknown }>
}

export function createBillingUpgradeStore(client: UpgradeRpcClient): UpgradeStore {
  async function call(name: UpgradeRpcName, request: Json): Promise<unknown> {
    const { data, error } = await client.rpc(name, { p_request: request })
    if (error) {
      // Eligibility and confirmation denials are typed RPC result envelopes.
      // SQLSTATE 22023 validation and 55000 sandbox failures expose no details.
      throw new Error('Billing upgrade database operation failed')
    }
    return data
  }
  return {
    reserve: input => call('billing_reserve_upgrade_v1', input), get: input => call('billing_get_upgrade_v1', input),
    list: input => call('billing_list_upgrades_v1', input), claim: input => call('billing_claim_upgrade_v1', input),
    checkpoint: input => call('billing_checkpoint_upgrade_v1', input), confirm: input => call('billing_confirm_upgrade_v1', input),
    finish: input => call('billing_finish_upgrade_v1', input), getApplied: input => call('billing_get_applied_upgrade_v1', input),
  }
}
