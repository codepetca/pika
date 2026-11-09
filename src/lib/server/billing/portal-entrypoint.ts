import { requireRole } from '@/lib/auth'
import { readBillingPortalConfig } from './portal-config'
import { createBillingPortalRuntime } from './portal-runtime'
import { createBillingPortalHandler } from './portal-handlers'

export const billingPortalHandler = createBillingPortalHandler({
  configuration: readBillingPortalConfig,
  authenticate: () => requireRole('teacher'),
  async open(userId) {
    const config = readBillingPortalConfig()
    if (!config) throw new Error('Portal unavailable')
    return createBillingPortalRuntime(config, config.portalConfigurationId).open(userId)
  },
})
