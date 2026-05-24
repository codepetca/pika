import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  deleteStudentTestAttemptsAtomic,
  getKnownTestWorkDeletionRpcError,
  MAX_TEST_WORK_DELETIONS_PER_REQUEST,
  normalizeStudentIds,
} from '@/lib/server/test-work-deletion'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/students/attempts/bulk-delete - Atomically delete selected students' test work
export const POST = withErrorHandler('BulkDeleteTeacherTestStudentAttempts', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const body = await request.json()
  const studentIds = normalizeStudentIds(body?.student_ids)

  if (studentIds.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }

  if (studentIds.length > MAX_TEST_WORK_DELETIONS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Cannot delete test work for more than ${MAX_TEST_WORK_DELETIONS_PER_REQUEST} students at once` },
      { status: 400 }
    )
  }

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', access.test.classroom_id)
    .in('student_id', studentIds)

  if (enrollmentError) {
    console.error('Error validating enrollment for selected test work deletion:', enrollmentError)
    return NextResponse.json({ error: 'Failed to validate selected students' }, { status: 500 })
  }

  const enrolledStudentIds = new Set((enrollmentRows || []).map((row) => row.student_id))
  const allSelectedStudentsAreEnrolled = studentIds.every((studentId) => enrolledStudentIds.has(studentId))
  if (!allSelectedStudentsAreEnrolled) {
    return NextResponse.json(
      { error: 'One or more selected students are not enrolled in this classroom' },
      { status: 400 }
    )
  }

  const { data, error } = await deleteStudentTestAttemptsAtomic({
    supabase,
    testId,
    studentIds,
  })

  if (error) {
    const knownError = getKnownTestWorkDeletionRpcError(error)
    if (knownError) {
      return NextResponse.json({ error: knownError.message }, { status: knownError.status })
    }

    console.error('Error bulk deleting selected student test work:', error)
    return NextResponse.json({ error: 'Failed to delete selected student test work' }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    requested_count: Number(data?.requested_count ?? studentIds.length),
    deleted_student_count: Number(data?.deleted_student_count ?? 0),
    deleted_attempts: Number(data?.deleted_attempts ?? 0),
    deleted_responses: Number(data?.deleted_responses ?? 0),
    deleted_focus_events: Number(data?.deleted_focus_events ?? 0),
    deleted_ai_grading_items: Number(data?.deleted_ai_grading_items ?? 0),
  })
})
