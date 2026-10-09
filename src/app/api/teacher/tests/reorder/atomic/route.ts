import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeSharedTestDetailReadActor } from '@/lib/server/contextual-test-detail-read'
import { reorderContextualTests } from '@/lib/server/contextual-test-reorder'
import {
  contextualTestReorderRequestSchema, readContextualTestReorderBody, TEST_REORDER_DEADLINE_MS,
} from '@/lib/validations/contextual-test-reorder'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Prepared endpoint; adoption stays behind separate rollout authority. */
export const POST = withErrorHandler('ReorderContextualTests', async request => {
  const actor = await authorizeSharedTestDetailReadActor()
  if (actor.mode !== 'shared') throw new ApiError(404, 'Test reorder unavailable')
  const deadline = Date.now() + TEST_REORDER_DEADLINE_MS
  const unavailable = () => new ApiError(503, 'Unable to verify test reorder')
  try {
    const decoded = await readContextualTestReorderBody(request, deadline)
    const input = contextualTestReorderRequestSchema.parse(decoded.body)
    if (request.signal.aborted || Date.now() >= deadline) throw unavailable()
    await reorderContextualTests({ supabase: getServiceRoleClient(), actorId: actor.user.id,
      input, deadline, bodyBytes: decoded.bytes, signal: request.signal })
    return NextResponse.json({ success: true })
  } catch (error) {
    if (request.signal.aborted || Date.now() >= deadline) throw unavailable()
    if (!(error instanceof ApiError) && !(error instanceof ZodError)) throw unavailable()
    throw error
  }
})
