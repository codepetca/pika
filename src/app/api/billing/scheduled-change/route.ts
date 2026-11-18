import { withErrorHandler } from '@/lib/api-handler'
import { getLiveScheduledChangeOffers, scheduledPlanChangeHandlers } from '@/lib/server/billing/scheduled-plan-change-entrypoints'

export const dynamic = 'force-dynamic'
export const GET = withErrorHandler('GetLiveScheduledChangeOffers', getLiveScheduledChangeOffers, {
  cacheControl: 'private, no-store',
})
export const POST = withErrorHandler('PostBillingScheduledChange', (request, context) => scheduledPlanChangeHandlers.reserve(request, context))
