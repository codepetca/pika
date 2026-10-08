import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { withErrorHandler } from '@/lib/api-handler'
import { saveAssignmentGradesAtomic, saveAssignmentGradesForOwner } from '@/lib/server/assignment-grades'
import { authorizeContextualAssignmentGradingRequest } from '@/lib/server/contextual-assignment-grading-access'
import { saveSelectedAssignmentGradesSchema } from '@/lib/validations/assignment-grading'
import { assignmentIdSchema } from '@/lib/validations/assignment-identifiers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/grade-selected - Save the same grade for selected students
export const POST = withErrorHandler('PostTeacherAssignmentGradeSelected', async (request, context) => {
  const access = await authorizeContextualAssignmentGradingRequest(async () => (
    await context.params
  ).id)
  const id = assignmentIdSchema.parse(access.assignmentId)
  const { studentIds, expectedDocUpdatedAtByStudent = {}, grade } =
    saveSelectedAssignmentGradesSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const gradeRequest = {
    studentIds,
    expectedDocUpdatedAtByStudent,
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

  return NextResponse.json({
    updated_count: docs.length,
    updated_student_ids: docs.map((doc) => doc.student_id),
    docs,
  })
})
