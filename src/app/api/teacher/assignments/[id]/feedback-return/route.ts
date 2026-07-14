import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { returnAssignmentFeedback } from '@/lib/server/assignment-returns'
import { assertTeacherCanMutateAssignment } from '@/lib/server/assignments'
import { returnAssignmentFeedbackSchema } from '@/lib/validations/assignment-returns'
import { assignmentIdSchema } from '@/lib/validations/assignment-identifiers'

export const POST = withErrorHandler('PostTeacherAssignmentFeedbackReturn', async (request, context) => {
  const user = await requireRole('teacher')
  const assignmentId = assignmentIdSchema.parse((await context.params).id)
  await assertTeacherCanMutateAssignment(user.id, assignmentId)
  const { studentId, feedback, expectedDocUpdatedAt } = returnAssignmentFeedbackSchema.parse(await request.json())
  const result = await returnAssignmentFeedback({
    assignmentId,
    studentId,
    teacherId: user.id,
    feedback,
    expectedDocUpdatedAt,
  })

  return NextResponse.json(result)
})
