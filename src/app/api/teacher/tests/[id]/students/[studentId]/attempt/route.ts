import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isMissingDeleteAttemptRpcError(error: {
  message?: string
  code?: string
  details?: string | null
  hint?: string | null
} | null | undefined): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    combined.includes('delete_student_test_attempt_atomic')
  )
}

// DELETE /api/teacher/tests/[id]/students/[studentId]/attempt - Delete one student's test work
export const DELETE = withErrorHandler('DeleteTeacherTestStudentAttempt', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, studentId } = await context.params

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const { data: enrollment, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', access.test.classroom_id)
    .eq('student_id', studentId)
    .maybeSingle()

  if (enrollmentError) {
    console.error('Error validating enrollment for student test deletion:', enrollmentError)
    return NextResponse.json({ error: 'Failed to validate student enrollment' }, { status: 500 })
  }
  if (!enrollment) {
    return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 400 })
  }

  const { data: deleteResult, error: deleteError } = await supabase.rpc(
    'delete_student_test_attempt_atomic',
    {
      p_test_id: testId,
      p_student_id: studentId,
    }
  )

  if (deleteError) {
    if (isMissingDeleteAttemptRpcError(deleteError)) {
      return NextResponse.json(
        { error: 'Deleting student test work requires migration 063 to be applied' },
        { status: 400 }
      )
    }
    console.error('Error deleting test attempt data for student:', deleteError)
    return NextResponse.json({ error: 'Failed to delete student test work' }, { status: 500 })
  }

  return NextResponse.json({
    deleted_attempts: Number(deleteResult?.deleted_attempts ?? 0),
    deleted_responses: Number(deleteResult?.deleted_responses ?? 0),
    deleted_focus_events: Number(deleteResult?.deleted_focus_events ?? 0),
    deleted_ai_grading_items: Number(deleteResult?.deleted_ai_grading_items ?? 0),
  })
})
