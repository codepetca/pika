import { withErrorHandler } from '@/lib/api-handler'
import { readBillingSandboxConfig } from '@/lib/server/billing/config'
import { createBillingHandlers } from '@/lib/server/billing/handlers'
import { createBillingRuntime } from '@/lib/server/billing/runtime'
import { readBillingPurchaseConfig } from '@/lib/server/billing/purchase-config'
import { createBillingPurchaseRuntime } from '@/lib/server/billing/purchase-runtime'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 180

const billingHandlers = createBillingHandlers(readBillingSandboxConfig, async () => {
  const config = readBillingSandboxConfig()
  if (!config) throw new Error('Billing runtime is unavailable')
  return createBillingRuntime(config)
}, async () => {
  const config = readBillingPurchaseConfig()
  if (!config) return null
  return createBillingPurchaseRuntime(config)
})

export const POST = withErrorHandler('PostStripeBillingProcess', async (request, context) => (
  billingHandlers.process(request, context)
))
