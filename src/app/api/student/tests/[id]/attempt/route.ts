import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  buildTestAttemptHistoryMetrics,
  normalizeTestResponses,
  validateTestResponsesAgainstQuestions,
  type TestResponses,
} from '@/lib/test-attempts'
import { insertVersionedBaselineHistory, persistVersionedHistory } from '@/lib/server/versioned-history'
import type { TestAttemptHistoryEntry } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const HISTORY_MIN_INTERVAL_MS = 10_000
const HISTORY_SELECT_FIELDS =
  'id, test_attempt_id, patch, snapshot, word_count, char_count, paste_word_count, keystroke_count, trigger, created_at'

// PATCH /api/student/tests/[id]/attempt - Autosave draft test responses
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: testId } = await params
    const body = await request.json()
    const trigger = body?.trigger
    const responses = normalizeTestResponses(body?.responses)
    const pasteWordCount = Math.max(0, Math.round(Number(body?.paste_word_count) || 0))
    const keystrokeCount = Math.max(0, Math.round(Number(body?.keystroke_count) || 0))

    if (!body?.responses || typeof body.responses !== 'object' || Array.isArray(body.responses)) {
      return NextResponse.json({ error: 'Responses are required' }, { status: 400 })
    }

    if (trigger && trigger !== 'autosave' && trigger !== 'blur') {
      return NextResponse.json({ error: 'Invalid trigger' }, { status: 400 })
    }

    const access = await assertStudentCanAccessTest(user.id, testId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test

    if (test.status !== 'active') {
      return NextResponse.json({ error: 'Cannot edit a test that is not active' }, { status: 403 })
    }

    const supabase = getServiceRoleClient()

    const { data: questions, error: questionsError } = await supabase
      .from('test_questions')
      .select('id, question_type, options, response_max_chars')
      .eq('test_id', testId)

    if (questionsError || !questions) {
      console.error('Error fetching test questions for draft save:', questionsError)
      return NextResponse.json({ error: 'Failed to validate responses' }, { status: 500 })
    }

    const validation = validateTestResponsesAgainstQuestions(responses, questions)
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { data: existingAttempt, error: attemptError } = await supabase
      .from('test_attempts')
      .select('id, responses, is_submitted')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .maybeSingle()

    if (attemptError?.code === 'PGRST205') {
      return NextResponse.json(
        { error: 'Tests draft autosave requires migration 038 to be applied' },
        { status: 400 }
      )
    }

    if (attemptError) {
      console.error('Error fetching existing test attempt:', attemptError)
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
    }

    if (existingAttempt?.is_submitted) {
      return NextResponse.json(
        { error: 'Cannot edit a submitted test' },
        { status: 403 }
      )
    }

    const { data: existingSubmittedResponses, error: existingResponsesError } = await supabase
      .from('test_responses')
      .select('id')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .limit(1)

    if (existingResponsesError) {
      console.error('Error checking existing submitted test responses:', existingResponsesError)
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
    }

    if ((existingSubmittedResponses?.length || 0) > 0) {
      return NextResponse.json(
        { error: 'Cannot edit a submitted test' },
        { status: 403 }
      )
    }

    let historyEntry: TestAttemptHistoryEntry | null = null

    if (!existingAttempt) {
      const { data: createdAttempt, error: createError } = await supabase
        .from('test_attempts')
        .insert({
          test_id: testId,
          student_id: user.id,
          responses,
          is_submitted: false,
          submitted_at: null,
        })
        .select('id, test_id, student_id, responses, is_submitted, submitted_at, created_at, updated_at')
        .single()

      if (createError || !createdAttempt) {
        console.error('Error creating test attempt:', createError)
        return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
      }

      try {
        historyEntry = await insertVersionedBaselineHistory<TestResponses>({
          supabase,
          table: 'test_attempt_history',
          ownerColumn: 'test_attempt_id',
          ownerId: createdAttempt.id,
          content: responses,
          selectFields: HISTORY_SELECT_FIELDS,
          trigger: 'baseline',
          buildMetrics: (currentResponses: TestResponses) =>
            buildTestAttemptHistoryMetrics(currentResponses, pasteWordCount, keystrokeCount),
        })
      } catch (historyError) {
        console.error('Error creating test attempt history baseline:', historyError)
      }

      return NextResponse.json({ attempt: createdAttempt, historyEntry })
    }

    const previousResponses = normalizeTestResponses(existingAttempt.responses)
    const { data: updatedAttempt, error: updateError } = await supabase
      .from('test_attempts')
      .update({
        responses,
      })
      .eq('id', existingAttempt.id)
      .select('id, test_id, student_id, responses, is_submitted, submitted_at, created_at, updated_at')
      .single()

    if (updateError || !updatedAttempt) {
      console.error('Error updating test attempt:', updateError)
      return NextResponse.json({ error: 'Failed to save responses' }, { status: 500 })
    }

    try {
      historyEntry = await persistVersionedHistory<TestResponses>({
        supabase,
        table: 'test_attempt_history',
        ownerColumn: 'test_attempt_id',
        ownerId: existingAttempt.id,
        previousContent: previousResponses,
        nextContent: responses,
        selectFields: HISTORY_SELECT_FIELDS,
        trigger: trigger ?? 'autosave',
        historyMinIntervalMs: HISTORY_MIN_INTERVAL_MS,
        buildMetrics: (currentResponses: TestResponses) =>
          buildTestAttemptHistoryMetrics(currentResponses, pasteWordCount, keystrokeCount),
      })
    } catch (historyError) {
      console.error('Error saving test attempt history:', historyError)
    }

    return NextResponse.json({ attempt: updatedAttempt, historyEntry })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Save test draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
