import { requireRole } from '@/lib/auth'
import { createBillingUpgradeHandlers } from './upgrade-handlers'
import { createBillingUpgradeRuntime, readBillingUpgradeConfig } from './upgrade-runtime'

export const billingUpgradeHandlers = createBillingUpgradeHandlers({
  configuration: readBillingUpgradeConfig,
  authenticate: () => requireRole('teacher'),
  async loadRuntime() {
    const config = readBillingUpgradeConfig()
    if (!config) throw new Error('Billing upgrade runtime is unavailable')
    return createBillingUpgradeRuntime(config)
  },
})
