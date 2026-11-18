import { NextResponse } from 'next/server'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { ScheduledCancellationRequestSchema, ScheduledCancellationStatusSchema } from '@/lib/billing/scheduled-cancellation'
import { readBillingLivePaymentWorkerConfig } from '@/lib/server/billing/live-target'
import { readBillingJsonBody } from '@/lib/server/billing/request-body'
import { createLiveScheduledCancellationRpc } from '@/lib/server/billing/scheduled-cancellation-runtime'

export const dynamic = 'force-dynamic'
function configuration() {
  if (process.env.BILLING_LIVE_SCHEDULED_CANCELLATION_ENABLED !== 'true') throw new ApiError(404, 'Not found')
  const config = readBillingLivePaymentWorkerConfig()
  if (!config) throw new ApiError(404, 'Not found')
  return config
}
export const GET = withErrorHandler('GetBillingScheduledCancellation', async () => {
  const config = configuration()
  const user = await requireRole('teacher')
  const raw = await createLiveScheduledCancellationRpc(config)('billing_get_live_scheduled_cancellation_v1', { subject_user_id: user.id })
  return NextResponse.json(ScheduledCancellationStatusSchema.nullable().parse(raw))
}, { cacheControl: 'private, no-store' })
export const POST = withErrorHandler('PostBillingScheduledCancellation', async request => {
  const config = configuration()
  const user = await requireRole('teacher')
  if (request.headers.get('origin') !== config.appOrigin) throw new ApiError(403, 'Invalid request origin')
  const input = ScheduledCancellationRequestSchema.parse(await readBillingJsonBody(request))
  const raw = await createLiveScheduledCancellationRpc(config)('billing_request_live_scheduled_cancellation_v1', {
    subject_user_id: user.id, schedule_operation_id: input.scheduleOperationId, operation_id: input.operationId, action: input.action,
  })
  if (raw === null) throw new ApiError(404, 'Scheduled change operation not found')
  const result = ScheduledCancellationStatusSchema.parse(raw)
  if (result.scheduleOperationId !== input.scheduleOperationId || result.cancellationOperationId !== input.operationId) throw new Error('Invalid cancellation result')
  return NextResponse.json(result)
}, { cacheControl: 'private, no-store' })
