import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import type { BillingSandboxConfig } from './config'
import type { BillingLifecycleRuntime } from './lifecycle-handlers'
import type { BillingLiveTrialConfig } from './live-target'
import { createBillingLifecycleStore, createLiveTrialLifecycleStore } from './lifecycle-store'
import { applyDueBillingAccess, getBillingAccessStatus, startBillingTrial, type BillingLifecycleStore } from './lifecycle-service'
import { attemptRepoLightProvisionOutbox } from '../repolight-provision-runtime'
import { processDueBillingAssignmentReleases } from './assignment-releases'

function lifecycleRuntime(store: BillingLifecycleStore, client: ReturnType<typeof getServiceRoleClient>): BillingLifecycleRuntime {
  return {
    async startTrial(input) {
      const result = await startBillingTrial({ store, ...input })
      await attemptRepoLightProvisionOutbox({ client, teacherId: input.subjectUserId })
      return result
    },
    getStatus: input => getBillingAccessStatus({ store, ...input }),
    applyDue: input => applyDueBillingAccess({ store, ...input }),
  }
}

export function createBillingLifecycleRuntime(config: BillingSandboxConfig): BillingLifecycleRuntime {
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  return lifecycleRuntime(createBillingLifecycleStore(client), client)
}

export function createLiveTrialLifecycleRuntime(config: BillingLiveTrialConfig): BillingLifecycleRuntime {
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  return lifecycleRuntime(createLiveTrialLifecycleStore(client, config), client)
}

export async function processLiveTrialLifecycle(config: BillingLiveTrialConfig) {
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const { data, error } = await client.rpc('billing_live_trial_lifecycle_ready_v1', {
    p_project_ref: config.projectRef,
    p_stripe_account: config.stripeAccount,
  })
  if (error || data !== true) throw new ApiError(503, 'Live trial lifecycle is unavailable')
  const store = createLiveTrialLifecycleStore(client, config)
  const lifecycle = await applyDueBillingAccess({ store, limit: 25 })
  const assignmentReleases = await processDueBillingAssignmentReleases(client)
  await attemptRepoLightProvisionOutbox({ client })
  return { lifecycle, assignmentReleases }
}
