import { requireRole } from '@/lib/auth'
import { createBillingPurchaseHandlers } from '@/lib/server/billing/purchase-handlers'
import { readBillingPurchaseConfig } from '@/lib/server/billing/purchase-config'
import { createBillingPurchaseRuntime } from '@/lib/server/billing/purchase-runtime'
import { readBillingLivePaymentWorkerConfig } from './live-target'

const readPurchaseConfiguration = () => readBillingLivePaymentWorkerConfig() ?? readBillingPurchaseConfig()

export const billingPurchaseHandlers = createBillingPurchaseHandlers({
  configuration: readPurchaseConfiguration,
  authenticate: () => requireRole('teacher'),
  async loadRuntime() {
    const config = readPurchaseConfiguration()
    if (!config) throw new Error('Billing purchase runtime is unavailable')
    return createBillingPurchaseRuntime(config)
  },
})
