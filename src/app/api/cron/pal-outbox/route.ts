import { NextRequest, NextResponse } from 'next/server'

import { withErrorHandler } from '@/lib/api-handler'
import { deliverPalOutboxBatch } from '@/lib/server/pal-outbox'
import {
  loadPalOutboxStatus,
  requeuePalOutboxEvent,
} from '@/lib/server/pal-operations'
import { palOutboxRequeueRequestSchema } from '@/lib/validations/pal'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  return Boolean(cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`)
}

export const GET = withErrorHandler('GetPalOutboxStatus', async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await loadPalOutboxStatus())
})

export const POST = withErrorHandler('PostPalOutboxDelivery', async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return NextResponse.json(await deliverPalOutboxBatch())
})

export const PATCH = withErrorHandler('PatchPalOutboxRequeue', async (request: NextRequest) => {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { outbox_id: outboxId } = palOutboxRequeueRequestSchema.parse(
    await request.json(),
  )
  const requeued = await requeuePalOutboxEvent({ outboxId })
  if (!requeued) {
    return NextResponse.json(
      { error: 'Only a non-retryable Pal event can be requeued' },
      { status: 409 },
    )
  }
  return NextResponse.json({ requeued: true })
})
