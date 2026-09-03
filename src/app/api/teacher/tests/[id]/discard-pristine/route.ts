import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { discardPristineTestDraftAtomic } from '@/lib/server/pristine-draft-discard'

const discardRequestSchema = z.object({
  expected_draft_version: z.number().int().positive(),
}).strict()

export const POST = withErrorHandler('DiscardPristineTestDraft', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = discardRequestSchema.parse(await request.json())

  const result = await discardPristineTestDraftAtomic({
    testId: id,
    teacherId: user.id,
    expectedDraftVersion: body.expected_draft_version,
  })
  return NextResponse.json(result)
})
