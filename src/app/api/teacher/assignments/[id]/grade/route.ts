import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import {
  assertStudentsEnrolledForAssignmentGrade,
  loadTeacherOwnedAssignmentForGrade,
  upsertAssignmentGradeRows,
} from '@/lib/server/assignment-grades'
import { saveAssignmentGradeSchema } from '@/lib/validations/assignment-grading'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/grade - Save grade for a student
export const POST = withErrorHandler('PostTeacherAssignmentGrade', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const { studentId, grade } = saveAssignmentGradeSchema.parse(await request.json())

  const supabase = getServiceRoleClient()
  const assignment = await loadTeacherOwnedAssignmentForGrade({
    supabase,
    assignmentId: id,
    teacherId: user.id,
  })
  await assertStudentsEnrolledForAssignmentGrade({
    supabase,
    classroomId: assignment.classroom_id,
    studentIds: [studentId],
  })

  // Upsert supports grading students even when no submission/doc exists yet.
  const { data: docs, error: upsertError } = await upsertAssignmentGradeRows({
    supabase,
    assignmentId: id,
    studentIds: [studentId],
    grade,
  })
  const doc = Array.isArray(docs) ? docs[0] : null

  if (upsertError || !doc) {
    console.error('Error saving grade:', upsertError)
    return NextResponse.json({ error: 'Failed to save grade' }, { status: 500 })
  }

  return NextResponse.json({ doc })
})
