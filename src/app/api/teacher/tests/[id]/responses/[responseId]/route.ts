import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/tests/[id]/responses/[responseId] - Grade a test answer
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; responseId: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId, responseId } = await params
    const body = (await request.json()) as Record<string, unknown>

    const clearGrade = body.clear_grade === true
    if (body.clear_grade !== undefined && typeof body.clear_grade !== 'boolean') {
      return NextResponse.json({ error: 'clear_grade must be a boolean' }, { status: 400 })
    }

    let score: number | null = null
    let feedback: string | null = null
    if (!clearGrade) {
      const rawScore = Number(body.score)
      if (!Number.isFinite(rawScore) || rawScore < 0) {
        return NextResponse.json({ error: 'score must be a non-negative number' }, { status: 400 })
      }
      score = Math.round(rawScore * 100) / 100

      const normalizedFeedback = typeof body.feedback === 'string' ? body.feedback.trim() : ''
      feedback = normalizedFeedback.length > 0 ? normalizedFeedback : null
    }

    const metadataRequested =
      body.ai_grading_basis !== undefined ||
      body.ai_reference_answers !== undefined ||
      body.ai_model !== undefined

    let aiGradingBasis: 'teacher_key' | 'generated_reference' | null | undefined
    if (body.ai_grading_basis !== undefined) {
      if (body.ai_grading_basis === null) {
        aiGradingBasis = null
      } else if (
        body.ai_grading_basis === 'teacher_key' ||
        body.ai_grading_basis === 'generated_reference'
      ) {
        aiGradingBasis = body.ai_grading_basis
      } else {
        return NextResponse.json({ error: 'ai_grading_basis is invalid' }, { status: 400 })
      }
    }

    let aiReferenceAnswers: string[] | null | undefined
    if (body.ai_reference_answers !== undefined) {
      if (body.ai_reference_answers === null) {
        aiReferenceAnswers = null
      } else if (Array.isArray(body.ai_reference_answers)) {
        const normalized = body.ai_reference_answers
          .map((value) => (typeof value === 'string' ? value.trim() : ''))
          .filter((value) => value.length > 0)

        if (normalized.length > 3) {
          return NextResponse.json(
            { error: 'ai_reference_answers cannot have more than 3 items' },
            { status: 400 }
          )
        }
        if (normalized.length === 0) {
          return NextResponse.json({ error: 'ai_reference_answers cannot be empty' }, { status: 400 })
        }

        aiReferenceAnswers = normalized
      } else {
        return NextResponse.json({ error: 'ai_reference_answers must be an array or null' }, { status: 400 })
      }
    }

    let aiModel: string | null | undefined
    if (body.ai_model !== undefined) {
      if (body.ai_model === null) {
        aiModel = null
      } else if (typeof body.ai_model === 'string') {
        const normalized = body.ai_model.trim()
        aiModel = normalized || null
      } else {
        return NextResponse.json({ error: 'ai_model must be a string or null' }, { status: 400 })
      }
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
    if (!question) {
      return NextResponse.json({ error: 'Question not found for response' }, { status: 404 })
    }

    if (metadataRequested && question.question_type !== 'open_response') {
      return NextResponse.json(
        { error: 'AI grading metadata is only supported for open-response answers' },
        { status: 400 }
      )
    }

    const maxScore = Number(question.points ?? 0)
    if (score != null && score > maxScore) {
      return NextResponse.json(
        { error: `score cannot exceed ${maxScore}` },
        { status: 400 }
      )
    }

    const updatePayload: Record<string, unknown> = clearGrade
      ? {
          score: null,
          feedback: null,
          graded_at: null,
          graded_by: null,
          ai_grading_basis: null,
          ai_reference_answers: null,
          ai_model: null,
        }
      : {
          score,
          feedback,
          graded_at: new Date().toISOString(),
          graded_by: user.id,
        }

    if (!clearGrade && metadataRequested) {
      if (aiGradingBasis === null) {
        updatePayload.ai_grading_basis = null
        updatePayload.ai_reference_answers = null
        updatePayload.ai_model = null
      } else {
        const resolvedBasis =
          aiGradingBasis ??
          (Array.isArray(aiReferenceAnswers) && aiReferenceAnswers.length > 0
            ? 'generated_reference'
            : undefined)

        if (!resolvedBasis) {
          return NextResponse.json({ error: 'AI grading metadata is incomplete' }, { status: 400 })
        }

        if (resolvedBasis === 'generated_reference') {
          if (!Array.isArray(aiReferenceAnswers) || aiReferenceAnswers.length === 0) {
            return NextResponse.json(
              { error: 'generated_reference grading requires ai_reference_answers' },
              { status: 400 }
            )
          }
          updatePayload.ai_grading_basis = 'generated_reference'
          updatePayload.ai_reference_answers = aiReferenceAnswers
        } else {
          updatePayload.ai_grading_basis = 'teacher_key'
          updatePayload.ai_reference_answers = null
        }

        updatePayload.ai_model = aiModel ?? null
      }
    }

    const { data: updatedResponse, error: updateError } = await supabase
      .from('test_responses')
      .update(updatePayload)
      .eq('id', responseId)
      .eq('test_id', testId)
      .select('*')
      .single()

    if (updateError || !updatedResponse) {
      console.error('Error updating test response grade:', updateError)
      return NextResponse.json({ error: 'Failed to update grade' }, { status: 500 })
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
