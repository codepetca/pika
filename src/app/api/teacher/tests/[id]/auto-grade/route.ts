import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import {
  buildTestOpenResponseReferenceCacheKey,
  generateTestOpenResponseReferences,
  getTestOpenResponseGradingModel,
  normalizeTestOpenResponseReferenceAnswers,
  suggestTestOpenResponseGrade,
} from '@/lib/ai-test-grading'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONCURRENCY_LIMIT = 5

function parseCachedReferenceAnswers(raw: unknown): string[] | null {
  if (raw == null) return null
  try {
    return normalizeTestOpenResponseReferenceAnswers(raw)
  } catch {
    return null
  }
}

// POST /api/teacher/tests/[id]/auto-grade - AI grade open responses for selected students
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
      return NextResponse.json({ error: 'Cannot auto-grade more than 100 students at once' }, { status: 400 })
    }

    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const testTitle = access.test.title

    const supabase = getServiceRoleClient()
    const { data: openQuestionRows, error: openQuestionError } = await supabase
      .from('test_questions')
      .select('id')
      .eq('test_id', testId)
      .eq('question_type', 'open_response')

    if (openQuestionError) {
      console.error('Error fetching open test questions:', openQuestionError)
      return NextResponse.json({ error: 'Failed to load test questions' }, { status: 500 })
    }

    const openQuestionIds = (openQuestionRows || []).map((row) => row.id)
    if (openQuestionIds.length === 0) {
      return NextResponse.json({
        graded_students: 0,
        skipped_students: studentIds.length,
        graded_responses: 0,
        errors: ['This test has no open-response questions to auto-grade.'],
      })
    }

    const { data: responses, error: responsesError } = await supabase
      .from('test_responses')
      .select(`
        id,
        question_id,
        student_id,
        response_text,
        test_questions!inner (
          question_text,
          points,
          response_monospace,
          answer_key,
          ai_reference_cache_key,
          ai_reference_cache_answers,
          ai_reference_cache_model
        )
      `)
      .eq('test_id', testId)
      .in('student_id', studentIds)
      .in('question_id', openQuestionIds)

    if (responsesError) {
      console.error('Error loading test open responses for auto-grade:', responsesError)
      return NextResponse.json({ error: 'Failed to load test responses' }, { status: 500 })
    }

    type GradeTask = {
      responseId: string
      questionId: string
      studentId: string
      questionText: string
      responseText: string
      answerKey: string | null
      maxPoints: number
      responseMonospace: boolean
    }

    type OpenQuestionContext = {
      questionText: string
      maxPoints: number
      answerKey: string | null
      responseMonospace: boolean
      cacheKey: string | null
      cacheAnswers: string[] | null
      cacheModel: string | null
    }

    const tasksByStudent = new Map<string, GradeTask[]>()
    const questionContextById = new Map<string, OpenQuestionContext>()
    for (const row of responses || []) {
      const studentId = typeof row.student_id === 'string' ? row.student_id : null
      const questionId = typeof row.question_id === 'string' ? row.question_id : null
      if (!studentId) continue
      if (!questionId) continue

      const question = Array.isArray(row.test_questions)
        ? row.test_questions[0]
        : row.test_questions
      if (!question) continue

      if (!questionContextById.has(questionId)) {
        questionContextById.set(questionId, {
          questionText: String(question.question_text || ''),
          maxPoints: Number(question.points ?? 0),
          answerKey: typeof question.answer_key === 'string' ? question.answer_key : null,
          responseMonospace: question.response_monospace === true,
          cacheKey: typeof question.ai_reference_cache_key === 'string' ? question.ai_reference_cache_key : null,
          cacheAnswers: parseCachedReferenceAnswers(question.ai_reference_cache_answers),
          cacheModel: typeof question.ai_reference_cache_model === 'string' ? question.ai_reference_cache_model : null,
        })
      }

      const responseText = typeof row.response_text === 'string' ? row.response_text.trim() : ''
      if (!responseText) continue

      const context = questionContextById.get(questionId)
      if (!context) continue

      const task: GradeTask = {
        responseId: row.id,
        questionId,
        studentId,
        questionText: context.questionText,
        responseText,
        answerKey: context.answerKey,
        maxPoints: context.maxPoints,
        responseMonospace: context.responseMonospace,
      }

      const current = tasksByStudent.get(studentId) || []
      current.push(task)
      tasksByStudent.set(studentId, current)
    }

    const queue: GradeTask[] = []
    for (const studentId of studentIds) {
      queue.push(...(tasksByStudent.get(studentId) || []))
    }

    const eligibleStudentIds = new Set(
      studentIds.filter((studentId) => (tasksByStudent.get(studentId)?.length || 0) > 0)
    )

    let gradedResponses = 0
    const gradedStudentIds = new Set<string>()
    const failedStudentIds = new Set<string>()
    const errors: string[] = []
    const generatedReferencesByQuestionId = new Map<string, string[]>()
    const gradingModel = getTestOpenResponseGradingModel()
    const cacheWrites: Array<{
      questionId: string
      cacheKey: string
      cacheAnswers: string[]
      model: string
    }> = []

    const questionsNeedingReferences = new Map<string, {
      questionText: string
      maxPoints: number
      responseMonospace: boolean
    }>()
    for (const [questionId, context] of questionContextById.entries()) {
      if (context.answerKey) continue

      const expectedCacheKey = buildTestOpenResponseReferenceCacheKey({
        testTitle,
        questionText: context.questionText,
        maxPoints: context.maxPoints,
        model: gradingModel,
        isCodingQuestion: context.responseMonospace,
      })
      const cacheIsValid =
        context.cacheKey === expectedCacheKey &&
        context.cacheModel === gradingModel &&
        Array.isArray(context.cacheAnswers) &&
        context.cacheAnswers.length > 0

      if (cacheIsValid) {
        generatedReferencesByQuestionId.set(questionId, context.cacheAnswers as string[])
      } else {
        questionsNeedingReferences.set(questionId, {
          questionText: context.questionText,
          maxPoints: context.maxPoints,
          responseMonospace: context.responseMonospace,
        })
      }
    }

    const referenceGenerationErrorsByQuestionId = new Map<string, string>()
    await Promise.all(
      Array.from(questionsNeedingReferences.entries()).map(async ([questionId, question]) => {
        try {
          const expectedCacheKey = buildTestOpenResponseReferenceCacheKey({
            testTitle,
            questionText: question.questionText,
            maxPoints: question.maxPoints,
            model: gradingModel,
            isCodingQuestion: question.responseMonospace,
          })
          const referenceSet = await generateTestOpenResponseReferences({
            testTitle,
            questionText: question.questionText,
            maxPoints: question.maxPoints,
            responseMonospace: question.responseMonospace,
          })
          generatedReferencesByQuestionId.set(questionId, referenceSet.reference_answers)
          cacheWrites.push({
            questionId,
            cacheKey: expectedCacheKey,
            cacheAnswers: referenceSet.reference_answers,
            model: referenceSet.model,
          })
        } catch (error: any) {
          referenceGenerationErrorsByQuestionId.set(
            questionId,
            error?.message || 'Failed to generate reference answers'
          )
        }
      })
    )

    if (referenceGenerationErrorsByQuestionId.size > 0) {
      const blockedTaskStudents = new Set<string>()
      const runnableTasks: GradeTask[] = []

      for (const task of queue) {
        if (task.answerKey || !referenceGenerationErrorsByQuestionId.has(task.questionId)) {
          runnableTasks.push(task)
          continue
        }

        blockedTaskStudents.add(task.studentId)
        const reason = referenceGenerationErrorsByQuestionId.get(task.questionId) || 'Reference generation failed'
        errors.push(`${task.studentId}: ${reason}`)
      }

      for (const studentId of blockedTaskStudents) {
        failedStudentIds.add(studentId)
      }

      queue.length = 0
      queue.push(...runnableTasks)
    }

    if (cacheWrites.length > 0) {
      await Promise.all(
        cacheWrites.map(async (entry) => {
          const { error: cacheUpdateError } = await supabase
            .from('test_questions')
            .update({
              ai_reference_cache_key: entry.cacheKey,
              ai_reference_cache_answers: entry.cacheAnswers,
              ai_reference_cache_model: entry.model,
              ai_reference_cache_generated_at: new Date().toISOString(),
            })
            .eq('id', entry.questionId)
            .eq('test_id', testId)

          if (cacheUpdateError) {
            console.error('Failed to persist AI reference cache for test question:', {
              questionId: entry.questionId,
              error: cacheUpdateError,
            })
          }
        })
      )
    }

    async function runWorker() {
      while (queue.length > 0) {
        const task = queue.shift()
        if (!task) return

        try {
          const sharedReferences = task.answerKey
            ? undefined
            : generatedReferencesByQuestionId.get(task.questionId)
          if (!task.answerKey && (!sharedReferences || sharedReferences.length === 0)) {
            throw new Error('Missing shared reference answers for open-response question')
          }

          const suggestion = await suggestTestOpenResponseGrade({
            testTitle,
            questionText: task.questionText,
            responseText: task.responseText,
            maxPoints: task.maxPoints,
            answerKey: task.answerKey,
            referenceAnswers: sharedReferences,
            responseMonospace: task.responseMonospace,
          })

          const { error: updateError } = await supabase
            .from('test_responses')
            .update({
              score: suggestion.score,
              feedback: suggestion.feedback,
              graded_at: new Date().toISOString(),
              graded_by: user.id,
              ai_grading_basis: suggestion.grading_basis,
              ai_reference_answers:
                suggestion.grading_basis === 'generated_reference'
                  ? suggestion.reference_answers
                  : null,
              ai_model: suggestion.model,
            })
            .eq('id', task.responseId)
            .eq('test_id', testId)

          if (updateError) {
            throw new Error(updateError.message || 'Failed to save AI grade')
          }

          gradedResponses += 1
          gradedStudentIds.add(task.studentId)
        } catch (error: any) {
          failedStudentIds.add(task.studentId)
          const message = error?.message || 'Failed to auto-grade response'
          errors.push(`${task.studentId}: ${message}`)
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(CONCURRENCY_LIMIT, queue.length || 1) },
      () => runWorker()
    )
    await Promise.all(workers)

    const fullyGradedStudents = Array.from(gradedStudentIds).filter(
      (studentId) => !failedStudentIds.has(studentId)
    )

    const gradedStudents = fullyGradedStudents.length
    const skippedStudents = studentIds.length - gradedStudents

    return NextResponse.json({
      graded_students: gradedStudents,
      skipped_students: skippedStudents,
      eligible_students: eligibleStudentIds.size,
      graded_responses: gradedResponses,
      errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Auto-grade test responses error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
