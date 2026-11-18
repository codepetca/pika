import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { processLiveTrialLifecycle } from '@/lib/server/billing/lifecycle-runtime'
import { readBillingLiveTrialConfig } from '@/lib/server/billing/live-target'
import { assertBillingWorkerAuthorization } from '@/lib/server/billing/request-body'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 180

export const POST = withErrorHandler('PostLiveTrialProcess', async (request) => {
  const config = readBillingLiveTrialConfig()
  if (!config) throw new ApiError(404, 'Not found')
  assertBillingWorkerAuthorization(request, config.workerSecret)
  return NextResponse.json(await processLiveTrialLifecycle(config), {
    headers: { 'Cache-Control': 'private, no-store' },
  })
})
