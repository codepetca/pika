import { requireRole } from '@/lib/auth'
import { readBillingPurchaseConfig } from './purchase-config'
import { createBillingLifecycleHandlers } from './lifecycle-handlers'
import { readBillingLiveTrialConfig } from './live-target'
import { createBillingLifecycleRuntime, createLiveTrialLifecycleRuntime } from './lifecycle-runtime'

export const readBillingLifecycleConfiguration = () => readBillingLiveTrialConfig() ?? readBillingPurchaseConfig()

export const billingLifecycleHandlers = createBillingLifecycleHandlers({
  configuration: readBillingLifecycleConfiguration,
  authenticate: () => requireRole('teacher'),
  async loadRuntime() {
    const live = readBillingLiveTrialConfig()
    if (live) return createLiveTrialLifecycleRuntime(live)
    const config = readBillingPurchaseConfig()
    if (!config) throw new Error('Billing lifecycle runtime is unavailable')
    return createBillingLifecycleRuntime(config)
  },
})
