import { withErrorHandler } from '@/lib/api-handler'
import { billingUpgradeHandlers } from '@/lib/server/billing/upgrade-entrypoints'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const POST = withErrorHandler('PostBillingUpgrade', (request, context) => billingUpgradeHandlers.start(request, context))
