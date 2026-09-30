import { withErrorHandler } from '@/lib/api-handler'
import { billingLifecycleHandlers } from '@/lib/server/billing/lifecycle-entrypoints'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const GET = withErrorHandler('GetBillingSubscription', (request, context) => billingLifecycleHandlers.status(request, context))
