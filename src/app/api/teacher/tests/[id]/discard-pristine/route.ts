import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { discardPristineTestDraftAtomic } from '@/lib/server/pristine-draft-discard'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeSharedTestListReadActor } from '@/lib/server/contextual-test-list-read'
import { discardContextualPristineTestDraft } from '@/lib/server/contextual-test-pristine-discard'
import { contextualTestPristineDiscardQuerySchema, contextualTestPristineDiscardRequestSchema, readContextualTestPristineDiscardBody, TEST_PRISTINE_DISCARD_DEADLINE_MS } from '@/lib/validations/contextual-test-pristine-discard'

const discardRequestSchema = z.object({
  expected_draft_version: z.number().int().positive(),
  expected_test_updated_at: z.string().datetime({ offset: true }),
}).strict()

export const POST = withErrorHandler('DiscardPristineTestDraft', async (request, context) => {
  const admission = await authorizeSharedTestListReadActor()
  if (admission.mode === 'shared') {
    const deadline = Date.now() + TEST_PRISTINE_DISCARD_DEADLINE_MS
    const { id } = await context.params
    const { testId } = contextualTestPristineDiscardQuerySchema.parse({ testId: id })
    const decoded = await readContextualTestPristineDiscardBody(request, deadline)
    const input = contextualTestPristineDiscardRequestSchema.parse(decoded.body)
    return NextResponse.json(await discardContextualPristineTestDraft({ supabase: getServiceRoleClient(), actorId: admission.user.id,
      testId, input, deadline, bodyBytes: decoded.bytes, signal: request.signal }))
  }
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = discardRequestSchema.parse(await request.json())

  const result = await discardPristineTestDraftAtomic({
    testId: id,
    teacherId: user.id,
    expectedDraftVersion: body.expected_draft_version,
    expectedTestUpdatedAt: body.expected_test_updated_at,
  })
  return NextResponse.json(result)
})
