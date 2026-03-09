import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/clear-open-grades - Clear open-response scores/feedback for selected students
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
      return NextResponse.json(
        { error: 'Cannot clear grades for more than 100 students at once' },
        { status: 400 }
      )
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
      console.error('Error loading open test questions for clearing:', openQuestionError)
      return NextResponse.json({ error: 'Failed to load test questions' }, { status: 500 })
    }

    const openQuestionIds = (openQuestionRows || []).map((row) => row.id)
    if (openQuestionIds.length === 0) {
      return NextResponse.json({
        cleared_students: 0,
        skipped_students: studentIds.length,
        cleared_responses: 0,
      })
    }

    const { data: clearedRows, error: clearError } = await supabase
      .from('test_responses')
      .update({
        score: null,
        feedback: null,
        graded_at: null,
        graded_by: null,
        ai_grading_basis: null,
        ai_reference_answers: null,
        ai_model: null,
      })
      .eq('test_id', testId)
      .in('student_id', studentIds)
      .in('question_id', openQuestionIds)
      .select('id, student_id')

    if (clearError) {
      console.error('Error clearing open-response grades:', clearError)
      return NextResponse.json({ error: 'Failed to clear open-response grades' }, { status: 500 })
    }

    const clearedResponses = (clearedRows || []).length
    const clearedStudentIds = new Set((clearedRows || []).map((row) => row.student_id))
    const clearedStudents = clearedStudentIds.size
    const skippedStudents = studentIds.length - clearedStudents

    return NextResponse.json({
      cleared_students: clearedStudents,
      skipped_students: skippedStudents,
      cleared_responses: clearedResponses,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Clear test open-response grades error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
