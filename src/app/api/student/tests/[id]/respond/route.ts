import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import { buildTestAttemptHistoryMetrics, normalizeTestResponses, validateTestResponsesAgainstQuestions } from '@/lib/test-attempts'
import { insertVersionedBaselineHistory } from '@/lib/server/versioned-history'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const HISTORY_SELECT_FIELDS =
  'id, test_attempt_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at'

// POST /api/student/tests/[id]/respond - Submit all responses
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: testId } = await params
    const body = await request.json()
    const responses = normalizeTestResponses(body?.responses)

    if (!body?.responses || typeof body.responses !== 'object' || Array.isArray(body.responses)) {
      return NextResponse.json({ error: 'Responses are required' }, { status: 400 })
    }

    const access = await assertStudentCanAccessTest(user.id, testId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test
    const supabase = getServiceRoleClient()

    if (test.status !== 'active') {
      return NextResponse.json({ error: 'Test is not active' }, { status: 400 })
    }

    const { data: existingAttempt, error: attemptError } = await supabase
      .from('test_attempts')
      .select('id, responses, is_submitted')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .maybeSingle()

    if (attemptError && attemptError.code !== 'PGRST205') {
      console.error('Error fetching test attempt:', attemptError)
      return NextResponse.json({ error: 'Failed to submit responses' }, { status: 500 })
    }

    if (existingAttempt?.is_submitted) {
      return NextResponse.json({ error: 'You have already responded to this test' }, { status: 400 })
    }

    const { data: existingResponses } = await supabase
      .from('test_responses')
      .select('id')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .limit(1)

    if ((existingResponses?.length || 0) > 0) {
      return NextResponse.json({ error: 'You have already responded to this test' }, { status: 400 })
    }

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('id, options')
      .eq('test_id', testId)

    if (questionsError || !questions) {
      console.error('Error fetching test questions:', questionsError)
      return NextResponse.json({ error: 'Failed to fetch questions' }, { status: 500 })
    }

    const validation = validateTestResponsesAgainstQuestions(responses, questions, {
      requireAllQuestions: true,
    })
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const submittedAt = new Date().toISOString()
    const responsesToInsert = Object.entries(responses).map(([questionId, selectedOption]) => ({
      test_id: testId,
      question_id: questionId,
      student_id: user.id,
      selected_option: selectedOption as number,
      submitted_at: submittedAt,
    }))

    const { error: insertError } = await supabase
      .from('test_responses')
      .insert(responsesToInsert)

    if (insertError) {
      if (insertError.code === '23505') {
        return NextResponse.json({ error: 'You have already responded to this test' }, { status: 400 })
      }
      console.error('Error inserting test responses:', insertError)
      return NextResponse.json({ error: 'Failed to submit responses' }, { status: 500 })
    }

    if (attemptError?.code !== 'PGRST205') {
      const nextResponses = responses
      const attemptUpdatePayload = {
        responses: nextResponses,
        is_submitted: true,
        submitted_at: submittedAt,
      }

      let testAttemptId = existingAttempt?.id || null

      if (testAttemptId) {
        const { error: updateAttemptError } = await supabase
          .from('test_attempts')
          .update(attemptUpdatePayload)
          .eq('id', testAttemptId)

        if (updateAttemptError) {
          console.error('Error updating submitted test attempt:', updateAttemptError)
        }
      } else {
        const { data: createdAttempt, error: createAttemptError } = await supabase
          .from('test_attempts')
          .insert({
            test_id: testId,
            student_id: user.id,
            ...attemptUpdatePayload,
          })
          .select('id')
          .single()

        if (createAttemptError) {
          console.error('Error creating submitted test attempt:', createAttemptError)
        } else {
          testAttemptId = createdAttempt?.id ?? null
        }
      }

      if (testAttemptId) {
        try {
          await insertVersionedBaselineHistory<Record<string, number>>({
            supabase,
            table: 'test_attempt_history',
            ownerColumn: 'test_attempt_id',
            ownerId: testAttemptId,
            content: nextResponses,
            selectFields: HISTORY_SELECT_FIELDS,
            trigger: 'submit',
            buildMetrics: (currentResponses: Record<string, number>) =>
              buildTestAttemptHistoryMetrics(currentResponses),
          })
        } catch (historyError) {
          console.error('Error writing test attempt submit history:', historyError)
        }
      }
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Submit test response error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
