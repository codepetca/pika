import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { apiErrors, withErrorHandler } from '@/lib/api-handler'
import {
  assertStudentsEnrolledForAssignmentGrade,
  loadTeacherOwnedAssignmentForGrade,
  normalizeAssignmentGradeStudentIds,
  parseAssignmentGradePayload,
  upsertAssignmentGradeRows,
} from '@/lib/server/assignment-grades'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/grade-selected - Save the same grade for selected students
export const POST = withErrorHandler('PostTeacherAssignmentGradeSelected', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  const studentIds = normalizeAssignmentGradeStudentIds(body?.student_ids)

  if (studentIds.length === 0) {
    throw apiErrors.badRequest('student_ids array is required')
  }

  if (studentIds.length > 100) {
    throw apiErrors.badRequest('Cannot grade more than 100 students at once')
  }

  const grade = parseAssignmentGradePayload({
    score_completion: body?.score_completion,
    score_thinking: body?.score_thinking,
    score_workflow: body?.score_workflow,
    feedback: body?.feedback,
    save_mode: body?.save_mode,
    apply_target: body?.apply_target,
  })
  const supabase = getServiceRoleClient()
  const assignment = await loadTeacherOwnedAssignmentForGrade({
    supabase,
    assignmentId: id,
    teacherId: user.id,
  })

  await assertStudentsEnrolledForAssignmentGrade({
    supabase,
    classroomId: assignment.classroom_id,
    studentIds,
  })

  // Upsert supports grading students even when no submission/doc exists yet.
  // It intentionally leaves feedback_returned_at, returned_at, and feedback untouched.
  const { data: docs, error: upsertError } = await upsertAssignmentGradeRows({
    supabase,
    assignmentId: id,
    studentIds,
    grade,
  })

  if (upsertError || !docs) {
    console.error('Error saving selected grades:', upsertError)
    return NextResponse.json({ error: 'Failed to save selected grades' }, { status: 500 })
  }

  const updatedDocs = Array.isArray(docs) ? docs : []

  return NextResponse.json({
    updated_count: updatedDocs.length,
    updated_student_ids: updatedDocs.map((doc) => doc.student_id),
    docs: updatedDocs,
  })
})
