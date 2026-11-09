import { withErrorHandler } from '@/lib/api-handler'
import { scheduledPlanChangeHandlers } from '@/lib/server/billing/scheduled-plan-change-entrypoints'

export const dynamic = 'force-dynamic'
export const POST = withErrorHandler('PostBillingScheduledChange', (request, context) => scheduledPlanChangeHandlers.reserve(request, context))
