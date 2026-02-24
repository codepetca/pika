import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/tests/[id]/responses/[responseId] - Grade an open-response answer
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; responseId: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId, responseId } = await params
    const body = (await request.json()) as Record<string, unknown>

    const score = Number(body.score)
    if (!Number.isFinite(score) || score < 0) {
      return NextResponse.json({ error: 'score must be a non-negative number' }, { status: 400 })
    }

    const feedback = typeof body.feedback === 'string' ? body.feedback.trim() : ''
    if (!feedback) {
      return NextResponse.json({ error: 'feedback is required' }, { status: 400 })
    }

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const supabase = getServiceRoleClient()
    const { data: responseRow, error: responseError } = await supabase
      .from('test_responses')
      .select(`
        id,
        test_id,
        question_id,
        score,
        feedback,
        response_text,
        test_questions!inner (
          id,
          question_type,
          points
        )
      `)
      .eq('id', responseId)
      .eq('test_id', testId)
      .single()

    if (responseError || !responseRow) {
      return NextResponse.json({ error: 'Response not found' }, { status: 404 })
    }

    const question = Array.isArray(responseRow.test_questions)
      ? responseRow.test_questions[0]
      : responseRow.test_questions
    if (!question || question.question_type !== 'open_response') {
      return NextResponse.json(
        { error: 'Only open-response answers can be graded manually' },
        { status: 400 }
      )
    }

    const maxScore = Number(question.points ?? 0)
    if (score > maxScore) {
      return NextResponse.json(
        { error: `score cannot exceed ${maxScore}` },
        { status: 400 }
      )
    }

    const gradedAt = new Date().toISOString()
    const normalizedScore = Math.round(score * 100) / 100
    const { data: updatedResponse, error: updateError } = await supabase
      .from('test_responses')
      .update({
        score: normalizedScore,
        feedback,
        graded_at: gradedAt,
        graded_by: user.id,
      })
      .eq('id', responseId)
      .eq('test_id', testId)
      .select('*')
      .single()

    if (updateError || !updatedResponse) {
      console.error('Error updating test response grade:', updateError)
      return NextResponse.json({ error: 'Failed to update grade' }, { status: 500 })
    }

    const { error: clearFinalizeError } = await supabase
      .from('tests')
      .update({
        grading_finalized_at: null,
        grading_finalized_by: null,
      })
      .eq('id', testId)

    if (clearFinalizeError) {
      console.error('Error clearing test grading finalization:', clearFinalizeError)
    }

    return NextResponse.json({ response: updatedResponse })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Grade test response error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

