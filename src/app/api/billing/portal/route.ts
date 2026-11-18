import { withErrorHandler } from '@/lib/api-handler'
import { billingPortalHandler } from '@/lib/server/billing/portal-entrypoint'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const POST = withErrorHandler('PostBillingPortal', (request, context) => billingPortalHandler(request, context))
