import { withErrorHandler } from '@/lib/api-handler'
import { billingLifecycleHandlers } from '@/lib/server/billing/lifecycle-entrypoints'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const POST = withErrorHandler('PostBillingTrial', (request, context) => billingLifecycleHandlers.trial(request, context))
