import { withErrorHandler } from '@/lib/api-handler'
import { billingUpgradeHandlers } from '@/lib/server/billing/upgrade-entrypoints'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const POST = withErrorHandler('PostBillingUpgradeConfirm', (request, context) => billingUpgradeHandlers.confirm(request, context))
