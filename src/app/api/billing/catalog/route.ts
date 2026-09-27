import { withErrorHandler } from '@/lib/api-handler'
import { billingPurchaseHandlers } from '@/lib/server/billing/purchase-entrypoints'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const GET = withErrorHandler('GetBillingCatalog', (request, context) => (
  billingPurchaseHandlers.catalog(request, context)
))
