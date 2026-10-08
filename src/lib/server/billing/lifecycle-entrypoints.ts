import { requireRole } from '@/lib/auth'
import { readBillingPurchaseConfig } from './purchase-config'
import { createBillingLifecycleHandlers } from './lifecycle-handlers'
import { createBillingLifecycleRuntime } from './lifecycle-runtime'

export const billingLifecycleHandlers = createBillingLifecycleHandlers({
  configuration: readBillingPurchaseConfig,
  authenticate: () => requireRole('teacher'),
  async loadRuntime() {
    const config = readBillingPurchaseConfig()
    if (!config) throw new Error('Billing lifecycle runtime is unavailable')
    return createBillingLifecycleRuntime(config)
  },
})
