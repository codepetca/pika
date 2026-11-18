import type { Json } from '@/types/database.generated'
import type { BillingLiveTrialConfig } from './live-target'
import { BillingLifecycleEligibilityError, type BillingLifecycleStore } from './lifecycle-service'

type LifecycleRpcName = 'billing_start_trial_v1' | 'billing_get_access_status_v1' | 'billing_apply_due_access_v1'
export type BillingLifecycleRpcClient = {
  rpc(name: LifecycleRpcName, args: { p_request: Json }): PromiseLike<{ data: unknown; error: unknown }>
}
type LifecycleResult = { data: unknown; error: unknown }
const liveTrialRpcNames = {
  billing_start_trial_v1: 'billing_start_live_trial_v1',
  billing_get_access_status_v1: 'billing_get_live_access_status_v1',
  billing_apply_due_access_v1: 'billing_apply_due_live_trial_access_v1',
} as const satisfies Record<LifecycleRpcName, string>
type LiveTrialLifecycleRpcName = (typeof liveTrialRpcNames)[LifecycleRpcName]
type LiveTrialIdentity = { p_project_ref: string; p_stripe_account: string }
export type BillingLiveTrialLifecycleRpcClient = {
  rpc(name: LiveTrialLifecycleRpcName, args: LiveTrialIdentity & { p_payload: Json }): PromiseLike<LifecycleResult>
}

function lifecycleStore(request: (name: LifecycleRpcName, payload: Json) => PromiseLike<LifecycleResult>): BillingLifecycleStore {
  async function call(name: LifecycleRpcName, payload: Json): Promise<unknown> {
    const { data, error } = await request(name, payload)
    if (error) {
      if (name === 'billing_start_trial_v1' && typeof error === 'object' && 'code' in error && error.code === '55000'
        && 'message' in error) {
        if (error.message === 'billing_trial_ineligible') throw new BillingLifecycleEligibilityError()
        if (error.message === 'billing_live_trial_admission_disabled') {
          throw new BillingLifecycleEligibilityError('New trials are currently unavailable.')
        }
        if (error.message === 'billing_live_trial_future_releases') {
          throw new BillingLifecycleEligibilityError('Existing assignment schedules must be converted before starting a trial.')
        }
      }
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

export function createBillingLifecycleStore(client: BillingLifecycleRpcClient): BillingLifecycleStore {
  return lifecycleStore((name, payload) => client.rpc(name, { p_request: payload }))
}

export function createLiveTrialLifecycleStore(
  client: BillingLiveTrialLifecycleRpcClient,
  config: Pick<BillingLiveTrialConfig, 'projectRef' | 'stripeAccount'>,
): BillingLifecycleStore {
  return lifecycleStore((name, payload) => client.rpc(liveTrialRpcNames[name], {
    p_project_ref: config.projectRef,
    p_stripe_account: config.stripeAccount,
    p_payload: payload,
  }))
}
