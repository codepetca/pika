import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type DeleteResult = {
  data?: Array<{ id: string }> | null
  error?: { message?: string; code?: string; details?: string; hint?: string } | null
}

function deletedCount(result: DeleteResult): number {
  return Array.isArray(result.data) ? result.data.length : 0
}

function isMissingTableError(error: {
  message?: string
  code?: string
  details?: string | null
  hint?: string | null
} | null | undefined, tableName: string): boolean {
  if (!error) return false
  const combined = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`.toLowerCase()
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    (combined.includes(tableName.toLowerCase()) && combined.includes('schema cache'))
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

  const aiItemsDelete = await supabase
    .from('test_ai_grading_run_items')
    .delete()
    .eq('test_id', testId)
    .eq('student_id', studentId)
    .select('id')

  if (aiItemsDelete.error && !isMissingTableError(aiItemsDelete.error, 'test_ai_grading_run_items')) {
    console.error('Error deleting test AI grading run items for student:', aiItemsDelete.error)
    return NextResponse.json({ error: 'Failed to delete student test work' }, { status: 500 })
  }

  const responsesDelete = await supabase
    .from('test_responses')
    .delete()
    .eq('test_id', testId)
    .eq('student_id', studentId)
    .select('id')

  if (responsesDelete.error) {
    console.error('Error deleting finalized test responses for student:', responsesDelete.error)
    return NextResponse.json({ error: 'Failed to delete student test work' }, { status: 500 })
  }

  const focusEventsDelete = await supabase
    .from('test_focus_events')
    .delete()
    .eq('test_id', testId)
    .eq('student_id', studentId)
    .select('id')

  if (focusEventsDelete.error) {
    console.error('Error deleting test focus events for student:', focusEventsDelete.error)
    return NextResponse.json({ error: 'Failed to delete student test work' }, { status: 500 })
  }

  const attemptsDelete = await supabase
    .from('test_attempts')
    .delete()
    .eq('test_id', testId)
    .eq('student_id', studentId)
    .select('id')

  if (attemptsDelete.error) {
    console.error('Error deleting test attempt for student:', attemptsDelete.error)
    return NextResponse.json({ error: 'Failed to delete student test work' }, { status: 500 })
  }

  return NextResponse.json({
    deleted_attempts: deletedCount(attemptsDelete),
    deleted_responses: deletedCount(responsesDelete),
    deleted_focus_events: deletedCount(focusEventsDelete),
    deleted_ai_grading_items: aiItemsDelete.error ? 0 : deletedCount(aiItemsDelete),
  })
})
