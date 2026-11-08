import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { readBillingLivePaymentWorkerConfig } from '@/lib/server/billing/live-target'
import { processLiveBillingPaymentLifecycle } from '@/lib/server/billing/payment-runtime'
import { assertBillingWorkerAuthorization } from '@/lib/server/billing/request-body'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 180

export const POST = withErrorHandler('PostLiveStripeBillingProcess', async request => {
  const config = readBillingLivePaymentWorkerConfig()
  if (!config) throw new ApiError(404, 'Not found')
  assertBillingWorkerAuthorization(request, config.workerSecret)
  return NextResponse.json(await processLiveBillingPaymentLifecycle(config), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
})
