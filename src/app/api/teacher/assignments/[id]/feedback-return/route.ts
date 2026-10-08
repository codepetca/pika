import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { returnAssignmentFeedback, returnAssignmentFeedbackForOwner } from '@/lib/server/assignment-returns'
import { assertTeacherCanMutateAssignment } from '@/lib/server/assignments'
import { authorizeContextualAssignmentFeedbackReturnRequest } from '@/lib/server/contextual-assignment-feedback-return-access'
import { returnAssignmentFeedbackSchema } from '@/lib/validations/assignment-returns'
import { assignmentIdSchema } from '@/lib/validations/assignment-identifiers'

export const POST = withErrorHandler('PostTeacherAssignmentFeedbackReturn', async (request, context) => {
  const access = await authorizeContextualAssignmentFeedbackReturnRequest(async () => (
    await context.params
  ).id)
  const assignmentId = assignmentIdSchema.parse(access.assignmentId)
  if (access.mode === 'legacy') {
    await assertTeacherCanMutateAssignment(access.user.id, assignmentId)
  }
  const { studentId, feedback, expectedDocUpdatedAt } = returnAssignmentFeedbackSchema.parse(await request.json())
  const feedbackRequest = {
    assignmentId,
    studentId,
    feedback,
    expectedDocUpdatedAt,
  }
  const result = access.mode === 'contextual'
    ? await returnAssignmentFeedbackForOwner({
      ...feedbackRequest,
      actorId: access.user.id,
    })
    : await returnAssignmentFeedback({
      ...feedbackRequest,
      teacherId: access.user.id,
    })

  return NextResponse.json(result)
})
