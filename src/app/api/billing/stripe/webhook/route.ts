import { withErrorHandler } from '@/lib/api-handler'
import { readBillingSandboxConfig } from '@/lib/server/billing/config'
import { createBillingHandlers } from '@/lib/server/billing/handlers'
import { createBillingRuntime } from '@/lib/server/billing/runtime'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const billingHandlers = createBillingHandlers(readBillingSandboxConfig, async () => {
  const config = readBillingSandboxConfig()
  if (!config) throw new Error('Billing runtime is unavailable')
  return createBillingRuntime(config)
})

export const POST = withErrorHandler('PostStripeBillingWebhook', async (request, context) => (
  billingHandlers.webhook(request, context)
))
