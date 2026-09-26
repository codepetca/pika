import { requireRole } from '@/lib/auth'
import { createBillingPurchaseHandlers } from '@/lib/server/billing/purchase-handlers'
import { readBillingPurchaseConfig } from '@/lib/server/billing/purchase-config'
import { createBillingPurchaseRuntime } from '@/lib/server/billing/purchase-runtime'

export const billingPurchaseHandlers = createBillingPurchaseHandlers({
  configuration: readBillingPurchaseConfig,
  authenticate: () => requireRole('teacher'),
  async loadRuntime() {
    const config = readBillingPurchaseConfig()
    if (!config) throw new Error('Billing purchase runtime is unavailable')
    return createBillingPurchaseRuntime(config)
  },
})
