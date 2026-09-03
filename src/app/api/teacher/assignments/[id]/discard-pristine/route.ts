import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { discardPristineAssignmentDraftAtomic } from '@/lib/server/pristine-draft-discard'

const discardRequestSchema = z.object({
  expected_updated_at: z.string().datetime({ offset: true }),
}).strict()

export const POST = withErrorHandler('DiscardPristineAssignmentDraft', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = discardRequestSchema.parse(await request.json())

  const result = await discardPristineAssignmentDraftAtomic({
    assignmentId: id,
    teacherId: user.id,
    expectedUpdatedAt: body.expected_updated_at,
  })
  return NextResponse.json(result)
})
