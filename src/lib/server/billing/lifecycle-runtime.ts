import { getServiceRoleClient } from '@/lib/supabase'
import { createTargetBoundFetch } from '@/lib/server/supabase-target'
import type { BillingSandboxConfig } from './config'
import type { BillingLifecycleRuntime } from './lifecycle-handlers'
import { createBillingLifecycleStore } from './lifecycle-store'
import { applyDueBillingAccess, getBillingAccessStatus, startBillingTrial } from './lifecycle-service'

export function createBillingLifecycleRuntime(config: BillingSandboxConfig): BillingLifecycleRuntime {
  const client = getServiceRoleClient({ fetch: createTargetBoundFetch(config.supabaseOrigin) })
  const store = createBillingLifecycleStore(client)
  return {
    startTrial: input => startBillingTrial({ store, ...input }),
    getStatus: input => getBillingAccessStatus({ store, ...input }),
    applyDue: input => applyDueBillingAccess({ store, ...input }),
  }
}
