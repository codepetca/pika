import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/grading/finalize - Finalize grading for a test
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const supabase = getServiceRoleClient()
    const { data: openQuestions, error: openQuestionsError } = await supabase
      .from('test_questions')
      .select('id')
      .eq('test_id', testId)
      .eq('question_type', 'open_response')

    if (openQuestionsError) {
      console.error('Error loading open-response questions:', openQuestionsError)
      return NextResponse.json({ error: 'Failed to finalize grading' }, { status: 500 })
    }

    const openQuestionIds = (openQuestions || []).map((question) => question.id)
    let gradedOpenResponses = 0
    let ungradedOpenResponses = 0

    if (openQuestionIds.length > 0) {
      const { data: openResponses, error: openResponsesError } = await supabase
        .from('test_responses')
        .select('id, score, feedback')
        .eq('test_id', testId)
        .in('question_id', openQuestionIds)

      if (openResponsesError) {
        console.error('Error loading open-response grades:', openResponsesError)
        return NextResponse.json({ error: 'Failed to finalize grading' }, { status: 500 })
      }

      for (const response of openResponses || []) {
        const hasScore = typeof response.score === 'number'
        const hasFeedback = typeof response.feedback === 'string' && response.feedback.trim().length > 0
        if (hasScore && hasFeedback) {
          gradedOpenResponses += 1
        } else {
          ungradedOpenResponses += 1
        }
      }

      if (ungradedOpenResponses > 0) {
        return NextResponse.json(
          {
            error: 'Open responses still need grading',
            ungraded_open_responses: ungradedOpenResponses,
            graded_open_responses: gradedOpenResponses,
            open_question_count: openQuestionIds.length,
          },
          { status: 409 }
        )
      }
    }

    const finalizedAt = new Date().toISOString()
    const { error: updateError } = await supabase
      .from('tests')
      .update({
        grading_finalized_at: finalizedAt,
        grading_finalized_by: user.id,
      })
      .eq('id', testId)

    if (updateError) {
      console.error('Error finalizing test grading:', updateError)
      return NextResponse.json({ error: 'Failed to finalize grading' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      finalized_at: finalizedAt,
      ungraded_open_responses: 0,
      graded_open_responses: gradedOpenResponses,
      open_question_count: openQuestionIds.length,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Finalize test grading error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

