import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeSharedTestDetailReadActor } from '@/lib/server/contextual-test-detail-read'
import { publishContextualTest } from '@/lib/server/contextual-test-publication'
import {
  contextualTestPublicationQuerySchema, contextualTestPublicationRequestSchema,
  readContextualTestPublicationBody, TEST_PUBLICATION_DEADLINE_MS,
} from '@/lib/validations/contextual-test-publication'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Prepared endpoint only: no legacy dispatch and no UI/cutover activation. */
export const POST = withErrorHandler('PublishContextualTest', async (request, context) => {
  const actor = await authorizeSharedTestDetailReadActor()
  if (actor.mode !== 'shared') throw new ApiError(404, 'Test publication unavailable')
  const deadline = Date.now() + TEST_PUBLICATION_DEADLINE_MS
  const unavailable = () => new ApiError(503, 'Unable to verify test publication')
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    if (request.signal.aborted) throw unavailable()
    const params = await Promise.race([context.params, new Promise<never>((_, reject) => {
      abort = () => reject(unavailable())
      request.signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(abort, Math.max(0, deadline - Date.now()))
      if (request.signal.aborted) abort()
    })])
    if (request.signal.aborted || Date.now() >= deadline) throw unavailable()
    const { testId } = contextualTestPublicationQuerySchema.parse({ testId: params.id })
    const decoded = await readContextualTestPublicationBody(request, deadline)
    const input = contextualTestPublicationRequestSchema.parse(decoded.body)
    if (request.signal.aborted || Date.now() >= deadline) throw unavailable()
    return NextResponse.json(await publishContextualTest({ supabase: getServiceRoleClient(), actorId: actor.user.id,
      testId, input, deadline, bodyBytes: decoded.bytes, signal: request.signal }))
  } catch (error) {
    // Cancel unread bodies on params timeout/abort without awaiting hostile
    // stream callbacks. Reader/helper own cancellation once reading starts.
    if (request.signal.aborted || Date.now() >= deadline) {
      if (!request.body?.locked) void request.body?.cancel().catch(() => {})
      throw unavailable()
    }
    if (!(error instanceof ApiError) && !(error instanceof ZodError)) throw unavailable()
    throw error
  } finally {
    clearTimeout(timer)
    if (abort) request.signal.removeEventListener('abort', abort)
  }
})
