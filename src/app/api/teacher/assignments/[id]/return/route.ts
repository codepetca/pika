import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { returnAssignmentsToStudents } from '@/lib/server/assignment-returns'
import { returnAssignmentsSchema } from '@/lib/validations/assignment-returns'
import { assignmentIdSchema } from '@/lib/validations/assignment-identifiers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/return - Return assignment work to students
export const POST = withErrorHandler('PostTeacherAssignmentReturn', async (request, context) => {
  const user = await requireRole('teacher')
  const assignmentId = assignmentIdSchema.parse((await context.params).id)
  const { studentIds } = returnAssignmentsSchema.parse(await request.json())
  const result = await returnAssignmentsToStudents({
    assignmentId,
    teacherId: user.id,
    studentIds,
  })

  return NextResponse.json(result)
})
