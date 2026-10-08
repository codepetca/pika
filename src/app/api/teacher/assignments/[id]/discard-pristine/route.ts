import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { discardPristineAssignmentDraftAtomic } from '@/lib/server/pristine-draft-discard'
import { authorizeContextualAssignmentOwnerMutationRequest } from '@/lib/server/contextual-assignment-owner-mutation-access'
import { discardPristineAssignmentDraftForOwner } from '@/lib/server/contextual-assignment-owner-mutations'
import { getServiceRoleClient } from '@/lib/supabase'

const discardRequestSchema = z.object({
  expected_updated_at: z.string().datetime({ offset: true }),
}).strict()

export const POST = withErrorHandler('DiscardPristineAssignmentDraft', async (request, context) => {
  const resolveAssignmentId = async () => (await context.params).id
  const assignmentAccess = await authorizeContextualAssignmentOwnerMutationRequest(resolveAssignmentId)
  const id = assignmentAccess.assignmentId
  const user = assignmentAccess.user
  const body = discardRequestSchema.parse(await request.json())

  const result = assignmentAccess.mode === 'contextual'
    ? await discardPristineAssignmentDraftForOwner({
        supabase: getServiceRoleClient(),
        actorId: user.id,
        assignmentId: id,
        expectedUpdatedAt: body.expected_updated_at,
      })
    : await discardPristineAssignmentDraftAtomic({
        assignmentId: id,
        teacherId: user.id,
        expectedUpdatedAt: body.expected_updated_at,
      })
  return NextResponse.json(result)
})
