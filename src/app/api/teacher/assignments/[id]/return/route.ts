import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { returnAssignmentsForOwner, returnAssignmentsToStudents } from '@/lib/server/assignment-returns'
import { authorizeContextualAssignmentFeedbackReturnRequest } from '@/lib/server/contextual-assignment-feedback-return-access'
import { returnAssignmentsSchema } from '@/lib/validations/assignment-returns'
import { assignmentIdSchema } from '@/lib/validations/assignment-identifiers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/return - Return assignment work to students
export const POST = withErrorHandler('PostTeacherAssignmentReturn', async (request, context) => {
  const access = await authorizeContextualAssignmentFeedbackReturnRequest(async () => (
    await context.params
  ).id)
  const assignmentId = assignmentIdSchema.parse(access.assignmentId)
  const { studentIds } = returnAssignmentsSchema.parse(await request.json())
  const result = access.mode === 'contextual'
    ? await returnAssignmentsForOwner({
      assignmentId,
      actorId: access.user.id,
      studentIds,
    })
    : await returnAssignmentsToStudents({
      assignmentId,
      teacherId: access.user.id,
      studentIds,
    })

  return NextResponse.json(result)
})
