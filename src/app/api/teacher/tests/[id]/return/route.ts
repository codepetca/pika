import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  assertTeacherOwnsTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityMap,
  isMissingTestAttemptReturnColumnsError,
} from '@/lib/server/tests'
import { finalizeUnsubmittedTestAttemptsOnClose } from '@/lib/server/finalize-test-attempts'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function hasGradedOpenResponse(score: unknown): boolean {
  return (
    typeof score === 'number' &&
    Number.isFinite(score)
  )
}

function migrationRequiredResponse() {
  return NextResponse.json(
    { error: 'Returning tests requires migration 043 to be applied' },
    { status: 400 }
  )
}

// POST /api/teacher/tests/[id]/return - Return graded test work to selected students
export const POST = withErrorHandler('ReturnTeacherTest', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const body = await request.json()

  if (!Array.isArray(body?.student_ids) || body.student_ids.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }

  const studentIds: string[] = Array.from(
    new Set(
      body.student_ids
        .filter((value: unknown): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value: string) => value.trim())
    )
  )

  if (studentIds.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }
  if (studentIds.length > 100) {
    return NextResponse.json({ error: 'Cannot return more than 100 students at once' }, { status: 400 })
  }

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (access.test.status === 'draft') {
    return NextResponse.json({ error: 'Cannot return work for a draft test' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()
  const availabilityResult = await getTestStudentAvailabilityMap(supabase, testId, studentIds)
  if (availabilityResult.error && !availabilityResult.missingTable) {
    console.error('Error loading test access for return:', availabilityResult.error)
    return NextResponse.json({ error: 'Failed to load selected student access' }, { status: 500 })
  }

  const openStudentIds = studentIds.filter((studentId) => {
    const accessState = getEffectiveStudentTestAccess({
      testStatus: access.test.status,
      accessState: availabilityResult.stateByStudentId.get(studentId) ?? null,
    })
    return accessState.effective_access === 'open'
  })

  if (openStudentIds.length > 0) {
    return NextResponse.json(
      { error: 'Close selected students before returning their test work.' },
      { status: 409 }
    )
  }

  if (access.test.status === 'closed') {
    const finalizeResult = await finalizeUnsubmittedTestAttemptsOnClose(supabase, testId, {
      closedBy: user.id,
    })
    if (!finalizeResult.ok) {
      return NextResponse.json({ error: finalizeResult.error }, { status: finalizeResult.status })
    }
  }

  const { data: openQuestionRows, error: openQuestionError } = await supabase
    .from('test_questions')
    .select('id')
    .eq('test_id', testId)
    .eq('question_type', 'open_response')

  if (openQuestionError) {
    console.error('Error loading test questions for return:', openQuestionError)
    return NextResponse.json({ error: 'Failed to load test questions' }, { status: 500 })
  }

  const openQuestionIds = (openQuestionRows || []).map((row) => row.id)

  const { data: submittedAttemptRows, error: submittedAttemptError } = await supabase
    .from('test_attempts')
    .select('student_id, is_submitted, submitted_at')
    .eq('test_id', testId)
    .in('student_id', studentIds)

  if (submittedAttemptError && submittedAttemptError.code !== 'PGRST205') {
    console.error('Error loading test attempts for return:', submittedAttemptError)
    return NextResponse.json({ error: 'Failed to load test attempts' }, { status: 500 })
  }

  const submittedByStudent = new Map<string, string | null>()
  for (const row of submittedAttemptRows || []) {
    if (!row.is_submitted) continue
    submittedByStudent.set(row.student_id, row.submitted_at || null)
  }

  const { data: responseRows, error: responsesError } = await supabase
    .from('test_responses')
    .select('student_id, question_id, score, feedback, submitted_at')
    .eq('test_id', testId)
    .in('student_id', studentIds)

  if (responsesError) {
    console.error('Error loading test responses for return:', responsesError)
    return NextResponse.json({ error: 'Failed to load test responses' }, { status: 500 })
  }

  const responsesByStudent = new Map<string, typeof responseRows>()
  const openResponsesByStudent = new Map<string, typeof responseRows>()
  const latestSubmittedAtByStudent = new Map<string, string>()

  for (const row of responseRows || []) {
    const allRows = responsesByStudent.get(row.student_id) || []
    allRows.push(row)
    responsesByStudent.set(row.student_id, allRows)

    if (openQuestionIds.includes(row.question_id)) {
      const openRows = openResponsesByStudent.get(row.student_id) || []
      openRows.push(row)
      openResponsesByStudent.set(row.student_id, openRows)
    }

    const currentLatest = latestSubmittedAtByStudent.get(row.student_id)
    if (!currentLatest || new Date(row.submitted_at).getTime() > new Date(currentLatest).getTime()) {
      latestSubmittedAtByStudent.set(row.student_id, row.submitted_at)
    }
  }

  const eligibleStudentIds: string[] = []
  for (const studentId of studentIds) {
    const studentResponses = responsesByStudent.get(studentId) || []
    const hasSubmittedAttempt = submittedByStudent.has(studentId)
    const hasSubmittedWork = hasSubmittedAttempt || studentResponses.length > 0
    if (!hasSubmittedWork) continue

    if (hasSubmittedAttempt && !latestSubmittedAtByStudent.has(studentId)) {
      latestSubmittedAtByStudent.set(studentId, submittedByStudent.get(studentId) || '')
    }

    if (openQuestionIds.length === 0) {
      eligibleStudentIds.push(studentId)
      continue
    }

    const openResponses = openResponsesByStudent.get(studentId) || []
    const allOpenGraded = openResponses.every((row) =>
      hasGradedOpenResponse(row.score)
    )

    if (allOpenGraded) {
      eligibleStudentIds.push(studentId)
    }
  }

  const now = new Date().toISOString()

  if (eligibleStudentIds.length > 0) {
    const { error: updateError } = await supabase
      .from('test_attempts')
      .update({
        returned_at: now,
        returned_by: user.id,
      })
      .eq('test_id', testId)
      .in('student_id', eligibleStudentIds)

    if (updateError && updateError.code !== 'PGRST205') {
      if (isMissingTestAttemptReturnColumnsError(updateError)) {
        return migrationRequiredResponse()
      }
      console.error('Error updating existing attempts during return:', updateError)
      return NextResponse.json({ error: 'Failed to return test work' }, { status: 500 })
    }

    const { data: existingAttempts, error: existingAttemptsError } = await supabase
      .from('test_attempts')
      .select('student_id')
      .eq('test_id', testId)
      .in('student_id', eligibleStudentIds)

    if (existingAttemptsError && existingAttemptsError.code !== 'PGRST205') {
      console.error('Error loading existing attempts during return:', existingAttemptsError)
      return NextResponse.json({ error: 'Failed to return test work' }, { status: 500 })
    }

    const existingStudentIds = new Set((existingAttempts || []).map((row) => row.student_id))
    const missingAttemptRows = eligibleStudentIds
      .filter((studentId) => !existingStudentIds.has(studentId))
      .map((studentId) => ({
        test_id: testId,
        student_id: studentId,
        responses: {},
        is_submitted: true,
        submitted_at: latestSubmittedAtByStudent.get(studentId) || now,
        returned_at: now,
        returned_by: user.id,
      }))

    if (missingAttemptRows.length > 0) {
      const { error: insertMissingError } = await supabase
        .from('test_attempts')
        .insert(missingAttemptRows)

      if (insertMissingError) {
        if (isMissingTestAttemptReturnColumnsError(insertMissingError)) {
          return migrationRequiredResponse()
        }
        console.error('Error creating missing attempts during return:', insertMissingError)
        return NextResponse.json({ error: 'Failed to return test work' }, { status: 500 })
      }
    }
  }

  return NextResponse.json({
    returned_count: eligibleStudentIds.length,
    skipped_count: studentIds.length - eligibleStudentIds.length,
    test_closed: false,
  })
})
