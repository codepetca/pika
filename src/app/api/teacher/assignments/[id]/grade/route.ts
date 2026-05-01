import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { apiErrors, withErrorHandler } from '@/lib/api-handler'
import {
  assertStudentsEnrolledForAssignmentGrade,
  loadTeacherOwnedAssignmentForGrade,
  parseAssignmentGradePayload,
  upsertAssignmentGradeRows,
} from '@/lib/server/assignment-grades'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/grade - Save grade for a student
export const POST = withErrorHandler('PostTeacherAssignmentGrade', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  const {
    student_id,
    score_completion,
    score_thinking,
    score_workflow,
    feedback,
    save_mode,
  } = body

  if (!student_id || typeof student_id !== 'string') {
    throw apiErrors.badRequest('student_id is required')
  }

  const supabase = getServiceRoleClient()
  const grade = parseAssignmentGradePayload({
    score_completion,
    score_thinking,
    score_workflow,
    feedback,
    save_mode,
  })
  const assignment = await loadTeacherOwnedAssignmentForGrade({
    supabase,
    assignmentId: id,
    teacherId: user.id,
  })
  await assertStudentsEnrolledForAssignmentGrade({
    supabase,
    classroomId: assignment.classroom_id,
    studentIds: [student_id],
  })

  // Upsert supports grading students even when no submission/doc exists yet.
  const { data: docs, error: upsertError } = await upsertAssignmentGradeRows({
    supabase,
    assignmentId: id,
    studentIds: [student_id],
    grade,
  })
  const doc = Array.isArray(docs) ? docs[0] : null

  if (upsertError || !doc) {
    console.error('Error saving grade:', upsertError)
    return NextResponse.json({ error: 'Failed to save grade' }, { status: 500 })
  }

  return NextResponse.json({ doc })
})
