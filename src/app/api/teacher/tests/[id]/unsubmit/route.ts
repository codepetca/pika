import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherOwnsTest, isMissingTestAttemptClosureColumnsError } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import { buildTestAttemptHistoryMetrics, normalizeTestResponses } from '@/lib/test-attempts'
import { insertVersionedBaselineHistory } from '@/lib/server/versioned-history'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_STUDENTS_PER_REQUEST = 100
const HISTORY_SELECT_FIELDS =
  'id, test_attempt_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at'

function parseStudentIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        .map((item) => item.trim())
    )
  )
}

// POST /api/teacher/tests/[id]/unsubmit - Mark selected students' attempts unsubmitted
export const POST = withErrorHandler('UnsubmitTeacherTestAttempts', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const body = await request.json()
  const studentIds = parseStudentIds(body?.student_ids)

  if (studentIds.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }
  if (studentIds.length > MAX_STUDENTS_PER_REQUEST) {
    return NextResponse.json(
      { error: `Cannot unsubmit more than ${MAX_STUDENTS_PER_REQUEST} students at once` },
      { status: 400 }
    )
  }

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (access.test.status === 'draft') {
    return NextResponse.json({ error: 'Cannot unsubmit students for a draft test' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()
  const { data: enrollmentRows, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', access.test.classroom_id)
    .in('student_id', studentIds)

  if (enrollmentError) {
    console.error('Error validating unsubmit enrollment:', enrollmentError)
    return NextResponse.json({ error: 'Failed to validate selected students' }, { status: 500 })
  }

  const enrolledStudentIds = new Set((enrollmentRows || []).map((row) => row.student_id))
  const eligibleStudentIds = studentIds.filter((studentId) => enrolledStudentIds.has(studentId))
  const skippedEnrollmentCount = studentIds.length - eligibleStudentIds.length

  if (eligibleStudentIds.length === 0) {
    return NextResponse.json({ error: 'No selected students are enrolled in this classroom' }, { status: 400 })
  }

  const { data: unsubmittedAttempts, error: updateError } = await supabase
    .from('test_attempts')
    .update({
      is_submitted: false,
      submitted_at: null,
      returned_at: null,
      returned_by: null,
      closed_for_grading_at: null,
      closed_for_grading_by: null,
    })
    .eq('test_id', testId)
    .in('student_id', eligibleStudentIds)
    .select('id, student_id, responses')

  if (updateError) {
    if (isMissingTestAttemptClosureColumnsError(updateError)) {
      return NextResponse.json(
        { error: 'Unsubmitting test attempts requires migration 061 to be applied' },
        { status: 400 }
      )
    }
    console.error('Error unsubmitting test attempts:', updateError)
    return NextResponse.json({ error: 'Failed to unsubmit selected students' }, { status: 500 })
  }

  const unsubmittedStudentIds = new Set((unsubmittedAttempts || []).map((attempt) => attempt.student_id))
  const unsubmittedCount = unsubmittedStudentIds.size

  if (unsubmittedCount > 0) {
    const { error: deleteResponsesError } = await supabase
      .from('test_responses')
      .delete()
      .eq('test_id', testId)
      .in('student_id', Array.from(unsubmittedStudentIds))

    if (deleteResponsesError) {
      console.error('Error deleting finalized responses while unsubmitting:', deleteResponsesError)
      return NextResponse.json({ error: 'Failed to unsubmit selected students' }, { status: 500 })
    }

    for (const attempt of unsubmittedAttempts || []) {
      try {
        const responses = normalizeTestResponses(attempt.responses)
        await insertVersionedBaselineHistory({
          supabase,
          table: 'test_attempt_history',
          ownerColumn: 'test_attempt_id',
          ownerId: attempt.id,
          content: responses,
          selectFields: HISTORY_SELECT_FIELDS,
          trigger: 'teacher_unsubmit',
          buildMetrics: buildTestAttemptHistoryMetrics,
        })
      } catch (historyError) {
        console.error('Error writing test unsubmit history:', historyError)
      }
    }
  }

  return NextResponse.json({
    unsubmitted_count: unsubmittedCount,
    skipped_count: studentIds.length - unsubmittedCount,
    skipped_enrollment_count: skippedEnrollmentCount,
  })
})
