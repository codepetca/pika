import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function hasGradedOpenResponse(score: unknown, feedback: unknown): boolean {
  return (
    typeof score === 'number' &&
    Number.isFinite(score) &&
    typeof feedback === 'string' &&
    feedback.trim().length > 0
  )
}

// POST /api/teacher/tests/[id]/return - Return graded test work to selected students
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params
    const body = await request.json()

    if (!Array.isArray(body?.student_ids) || body.student_ids.length === 0) {
      return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
    }

    const studentIds = [...new Set(
      body.student_ids
        .map((value: unknown) => (typeof value === 'string' ? value : ''))
        .filter(Boolean)
    )]

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

    const supabase = getServiceRoleClient()

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
      if (studentResponses.length === 0) continue

      if (openQuestionIds.length === 0) {
        eligibleStudentIds.push(studentId)
        continue
      }

      const openResponses = openResponsesByStudent.get(studentId) || []
      if (openResponses.length < openQuestionIds.length) continue

      const allOpenGraded = openResponses.every((row) =>
        hasGradedOpenResponse(row.score, row.feedback)
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
          is_submitted: true,
        })
        .eq('test_id', testId)
        .in('student_id', eligibleStudentIds)

      if (updateError && updateError.code !== 'PGRST205') {
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
          console.error('Error creating missing attempts during return:', insertMissingError)
          return NextResponse.json({ error: 'Failed to return test work' }, { status: 500 })
        }
      }
    }

    return NextResponse.json({
      returned_count: eligibleStudentIds.length,
      skipped_count: studentIds.length - eligibleStudentIds.length,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Return test error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
