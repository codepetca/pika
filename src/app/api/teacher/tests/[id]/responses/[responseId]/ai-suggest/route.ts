import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest, validateSelectedTestStudentEnrollment } from '@/lib/server/tests'
import {
  getTestOpenResponseGradingModel,
  prepareTestOpenResponseGradingContext,
  resolveReusableTestOpenResponseReferenceAnswers,
  suggestTestOpenResponseGradeWithContext,
} from '@/lib/ai-test-grading'
import { withErrorHandler } from '@/lib/api-handler'
import { loadClassroomAiSanitizationContext } from '@/lib/server/ai-sanitization'
import { buildTestQuestionGradingSnapshot } from '@/lib/test-grading-context'
import { createManualTestAiProvenanceToken } from '@/lib/server/test-ai-provenance'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/responses/[responseId]/ai-suggest
export const POST = withErrorHandler('AiSuggestTeacherTestGrade', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, responseId } = await context.params

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
      student_id,
      response_text,
      revision,
      test_questions!inner (
        id,
        updated_at,
        question_type,
        question_text,
        points,
        response_monospace,
        answer_key,
        sample_solution,
        ai_reference_cache_key,
        ai_reference_cache_answers,
        ai_reference_cache_model
      )
    `)
    .eq('id', responseId)
    .eq('test_id', testId)
    .single()

  if (responseError || !responseRow) {
    return NextResponse.json({ error: 'Response not found' }, { status: 404 })
  }

  const responseStudentId = typeof responseRow.student_id === 'string' ? responseRow.student_id : ''
  if (!responseStudentId) {
    return NextResponse.json({ error: 'Response not found' }, { status: 404 })
  }

  const enrollmentValidation = await validateSelectedTestStudentEnrollment(
    supabase,
    access.test.classroom_id,
    [responseStudentId]
  )
  if (!enrollmentValidation.ok) {
    console.error('Error validating response student enrollment for AI suggest:', enrollmentValidation.error)
    return NextResponse.json({ error: 'Failed to validate student enrollment' }, { status: 500 })
  }
  if (enrollmentValidation.missingStudentIds.length > 0) {
    return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 400 })
  }

  const question = Array.isArray(responseRow.test_questions)
    ? responseRow.test_questions[0]
    : responseRow.test_questions
  if (!question || question.question_type !== 'open_response') {
    return NextResponse.json(
      { error: 'AI suggestions are only available for open-response answers' },
      { status: 400 }
    )
  }

  const responseText = typeof responseRow.response_text === 'string' ? responseRow.response_text.trim() : ''
  if (!responseText) {
    return NextResponse.json({ error: 'Response text is empty' }, { status: 400 })
  }

  const questionGradingSnapshot = buildTestQuestionGradingSnapshot({
    testTitle: access.test.title,
    question: {
      question_text: String(question.question_text || ''),
      points: typeof question.points === 'number' ? question.points : null,
      response_monospace:
        typeof question.response_monospace === 'boolean' ? question.response_monospace : null,
      answer_key: typeof question.answer_key === 'string' ? question.answer_key : null,
      sample_solution:
        typeof question.sample_solution === 'string' ? question.sample_solution : null,
    },
  })

  const currentModel = getTestOpenResponseGradingModel()
  const sanitizationContext = await loadClassroomAiSanitizationContext(
    supabase,
    access.test.classroom_id,
  )
  const referenceCache = resolveReusableTestOpenResponseReferenceAnswers({
    testTitle: access.test.title,
    questionText: String(question.question_text || ''),
    maxPoints: Number(question.points ?? 0),
    model: currentModel,
    isCodingQuestion: question.response_monospace === true,
    cacheKey:
      typeof question.ai_reference_cache_key === 'string'
        ? question.ai_reference_cache_key
        : null,
    cacheAnswers: question.ai_reference_cache_answers,
    cacheModel:
      typeof question.ai_reference_cache_model === 'string'
        ? question.ai_reference_cache_model
        : null,
  })

  const prepared = await prepareTestOpenResponseGradingContext({
    testTitle: access.test.title,
    questionText: String(question.question_text || ''),
    maxPoints: Number(question.points ?? 0),
    answerKey: typeof question.answer_key === 'string' ? question.answer_key : null,
    sampleSolution: typeof question.sample_solution === 'string' ? question.sample_solution : null,
    referenceAnswers: referenceCache.referenceAnswers,
    responseMonospace: question.response_monospace === true,
    promptProfile: 'manual',
    telemetryContext: {
      feature: 'test_ai_suggest',
      requestedStrategy: 'manual',
      resolvedStrategy: 'single',
    },
    sanitizationContext,
  })

  if (
    prepared.grading_basis === 'generated_reference' &&
    prepared.reference_answers_source === 'generated'
  ) {
    const { error: cacheUpdateError } = await supabase
      .from('test_questions')
      .update({
        ai_reference_cache_key: referenceCache.expectedCacheKey,
        ai_reference_cache_answers: prepared.reference_answers,
        ai_reference_cache_model: prepared.model,
        ai_reference_cache_generated_at: new Date().toISOString(),
      })
      .eq('id', question.id)
      .eq('test_id', testId)
      .eq('updated_at', question.updated_at)

    if (cacheUpdateError) {
      console.error('Error caching generated reference answers for AI suggest:', {
        testId,
        questionId: question.id,
        error: cacheUpdateError,
      })
    }
  }

  const suggestion = await suggestTestOpenResponseGradeWithContext(prepared, responseText, {
    feature: 'test_ai_suggest',
    requestedStrategy: 'manual',
    resolvedStrategy: 'single',
  })
  const responseRevision = Number(responseRow.revision)
  if (!Number.isSafeInteger(responseRevision) || responseRevision < 1) {
    return NextResponse.json({ error: 'Response revision is unavailable' }, { status: 409 })
  }
  const aiProvenanceToken = createManualTestAiProvenanceToken({
    teacherId: user.id,
    testId,
    responseId,
    responseRevision,
    gradingBasis: suggestion.grading_basis,
    referenceAnswers:
      suggestion.grading_basis === 'generated_reference'
        ? suggestion.reference_answers
        : null,
    model: suggestion.model,
    suggestedScore: suggestion.score,
    suggestedFeedback: suggestion.feedback,
    questionGradingSnapshot,
  })

  return NextResponse.json({
    suggestion,
    max_points: Number(question.points ?? 0),
    question_grading_snapshot: questionGradingSnapshot,
    ai_provenance_token: aiProvenanceToken,
  })
})
