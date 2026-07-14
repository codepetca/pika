import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { saveAssignmentGradesAtomic } from '@/lib/server/assignment-grades'
import { saveSelectedAssignmentGradesSchema } from '@/lib/validations/assignment-grading'
import { assignmentIdSchema } from '@/lib/validations/assignment-identifiers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/grade-selected - Save the same grade for selected students
export const POST = withErrorHandler('PostTeacherAssignmentGradeSelected', async (request, context) => {
  const user = await requireRole('teacher')
  const id = assignmentIdSchema.parse((await context.params).id)
  const { studentIds, expectedDocUpdatedAtByStudent = {}, grade } =
    saveSelectedAssignmentGradesSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const docs = await saveAssignmentGradesAtomic({
    supabase,
    assignmentId: id,
    teacherId: user.id,
    studentIds,
    expectedDocUpdatedAtByStudent,
    grade,
  })

  return NextResponse.json({
    updated_count: docs.length,
    updated_student_ids: docs.map((doc) => doc.student_id),
    docs,
  })
})
