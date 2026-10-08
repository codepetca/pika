import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler } from '@/lib/api-handler'
import { saveAssignmentGradesAtomic, saveAssignmentGradesForOwner } from '@/lib/server/assignment-grades'
import { authorizeContextualAssignmentGradingRequest } from '@/lib/server/contextual-assignment-grading-access'
import { saveAssignmentGradeSchema } from '@/lib/validations/assignment-grading'
import { assignmentIdSchema } from '@/lib/validations/assignment-identifiers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/grade - Save grade for a student
export const POST = withErrorHandler('PostTeacherAssignmentGrade', async (request, context) => {
  const access = await authorizeContextualAssignmentGradingRequest(async () => (
    await context.params
  ).id)
  const id = assignmentIdSchema.parse(access.assignmentId)
  const { studentId, expectedDocUpdatedAt, grade } = saveAssignmentGradeSchema.parse(await request.json())

  const supabase = getServiceRoleClient()
  const gradeRequest = {
    studentIds: [studentId],
    expectedDocUpdatedAtByStudent:
      expectedDocUpdatedAt === undefined ? {} : { [studentId]: expectedDocUpdatedAt },
    grade,
  }
  const docs = access.mode === 'contextual'
    ? await saveAssignmentGradesForOwner({
      supabase,
      assignmentId: id,
      actorId: access.user.id,
      ...gradeRequest,
    })
    : await saveAssignmentGradesAtomic({
      supabase,
      assignmentId: id,
      teacherId: access.user.id,
      ...gradeRequest,
    })

  return NextResponse.json({ doc: docs[0] })
})
