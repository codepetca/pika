import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { suggestTestOpenResponseGrade, getTestOpenResponseGradingModel } from '@/lib/ai-test-grading'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CONCURRENCY_LIMIT = 5

// POST /api/teacher/tests/[id]/auto-grade - AI grade open responses for selected students
export const POST = withErrorHandler('AutoGradeTeacherTest', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const body = await request.json()
  let promptGuidelineOverride: string | null | undefined = undefined

  if (!Array.isArray(body?.student_ids) || body.student_ids.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }
  if (Object.prototype.hasOwnProperty.call(body ?? {}, 'prompt_guideline')) {
    if (body.prompt_guideline != null && typeof body.prompt_guideline !== 'string') {
      return NextResponse.json({ error: 'prompt_guideline must be a string' }, { status: 400 })
    }
    promptGuidelineOverride = body.prompt_guideline
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
  const currentModel = getTestOpenResponseGradingModel()

  const supabase = getServiceRoleClient()
  const { data: openQuestionRows, error: openQuestionError } = await supabase
    .from('test_questions')
    .select('id, question_text, points, response_monospace, answer_key')
    .eq('test_id', testId)
    .eq('question_type', 'open_response')

  if (openQuestionError) {
    console.error('Error fetching open test questions:', openQuestionError)
    return NextResponse.json({ error: 'Failed to load test questions' }, { status: 500 })
  }

  const openQuestionIds = (openQuestionRows || []).map((row) => row.id)
  const openQuestionById = new Map(
    (openQuestionRows || []).map((row) => [
      row.id,
      {
        questionText: String(row.question_text || ''),
        maxPoints: Number(row.points ?? 0),
        responseMonospace: row.response_monospace === true,
        answerKey: typeof row.answer_key === 'string' ? row.answer_key : null,
      },
    ])
  )
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
      student_id,
      question_id,
      response_text,
      submitted_at,
      ai_model,
      graded_at,
      score
    `)
    .eq('test_id', testId)
    .in('student_id', studentIds)
    .in('question_id', openQuestionIds)

  if (responsesError) {
    console.error('Error loading test open responses for auto-grade:', responsesError)
    return NextResponse.json({ error: 'Failed to load test responses' }, { status: 500 })
  }

  const { data: attemptRows, error: attemptError } = await supabase
    .from('test_attempts')
    .select('student_id, is_submitted, submitted_at')
    .eq('test_id', testId)
    .in('student_id', studentIds)

  if (attemptError && attemptError.code !== 'PGRST205') {
    console.error('Error loading test attempts for auto-grade:', attemptError)
    return NextResponse.json({ error: 'Failed to load test attempts' }, { status: 500 })
  }

  const submittedAtByStudent = new Map<string, string | null>()
  for (const row of attemptRows || []) {
    if (!row.is_submitted) continue
    submittedAtByStudent.set(row.student_id, row.submitted_at || null)
  }

  type GradeTask = {
    responseId: string
    studentId: string
    questionText: string
    responseText: string
    maxPoints: number
    responseMonospace: boolean
    answerKey: string | null
  }

  const tasksByStudent = new Map<string, GradeTask[]>()
  const responseByStudentQuestion = new Map<string, {
    id: string
    student_id: string
    question_id: string
    response_text: string | null
    ai_model: string | null
    graded_at: string | null
    score: number | null
  }>()
  const submittedAtFromResponses = new Map<string, string>()

  for (const row of responses || []) {
    const studentId = typeof row.student_id === 'string' ? row.student_id : null
    if (!studentId) continue

    const questionId = typeof row.question_id === 'string' ? row.question_id : null
    if (!questionId) continue
    const questionMeta = openQuestionById.get(questionId)
    if (!questionMeta) continue

    responseByStudentQuestion.set(`${studentId}:${questionId}`, {
      id: String(row.id),
      student_id: studentId,
      question_id: questionId,
      response_text: typeof row.response_text === 'string' ? row.response_text : null,
      ai_model: typeof (row as any).ai_model === 'string' ? (row as any).ai_model : null,
      graded_at: typeof (row as any).graded_at === 'string' ? (row as any).graded_at : null,
      score: typeof (row as any).score === 'number' ? (row as any).score : null,
    })

    if (typeof row.submitted_at === 'string') {
      const previous = submittedAtFromResponses.get(studentId)
      if (!previous || new Date(row.submitted_at).getTime() > new Date(previous).getTime()) {
        submittedAtFromResponses.set(studentId, row.submitted_at)
      }
    }
  }

  if (attemptError?.code === 'PGRST205') {
    for (const [studentId, submittedAt] of submittedAtFromResponses) {
      submittedAtByStudent.set(studentId, submittedAt)
    }
  }

  const unansweredRowsToInsert: Array<{
    test_id: string
    question_id: string
    student_id: string
    selected_option: null
    response_text: string
    score: number
    feedback: string
    graded_at: string
    graded_by: string
    submitted_at: string
  }> = []
  const unansweredResponseIdsToGrade = new Set<string>()
  const completedQuestionsByStudent = new Map<string, number>()
  const failedStudentIds = new Set<string>()
  let cachedGradeCount = 0

  for (const studentId of studentIds) {
    if (!submittedAtByStudent.has(studentId)) continue
    const submittedAt = submittedAtByStudent.get(studentId) || new Date().toISOString()

    for (const questionId of openQuestionIds) {
      const questionMeta = openQuestionById.get(questionId)
      if (!questionMeta) continue

      const existing = responseByStudentQuestion.get(`${studentId}:${questionId}`)
      if (!existing) {
        unansweredRowsToInsert.push({
          test_id: testId,
          question_id: questionId,
          student_id: studentId,
          selected_option: null,
          response_text: '',
          score: 0,
          feedback: 'Unanswered',
          graded_at: new Date().toISOString(),
          graded_by: user.id,
          submitted_at: submittedAt,
        })
        completedQuestionsByStudent.set(
          studentId,
          (completedQuestionsByStudent.get(studentId) || 0) + 1
        )
        continue
      }

      const responseText = typeof existing.response_text === 'string' ? existing.response_text.trim() : ''
      if (!responseText) {
        unansweredResponseIdsToGrade.add(existing.id)
        completedQuestionsByStudent.set(
          studentId,
          (completedQuestionsByStudent.get(studentId) || 0) + 1
        )
        continue
      }

      // Skip if already graded with the same model — avoid redundant OpenAI calls.
      // TODO: When ai_score/teacher_score are stored in separate columns, AI should
      // always write ai_score without touching teacher_score, and this check can
      // simply compare ai_model to avoid re-calling the same model twice.
      const alreadyAiGraded =
        existing.ai_model === currentModel &&
        existing.graded_at != null &&
        existing.score != null
      if (alreadyAiGraded) {
        cachedGradeCount += 1
        completedQuestionsByStudent.set(
          studentId,
          (completedQuestionsByStudent.get(studentId) || 0) + 1
        )
        continue
      }

      const task: GradeTask = {
        responseId: existing.id,
        studentId,
        questionText: questionMeta.questionText,
        responseText,
        maxPoints: questionMeta.maxPoints,
        responseMonospace: questionMeta.responseMonospace,
        answerKey: questionMeta.answerKey,
      }
      const current = tasksByStudent.get(studentId) || []
      current.push(task)
      tasksByStudent.set(studentId, current)
    }
  }

  if (unansweredRowsToInsert.length > 0) {
    const { error: insertUnansweredError } = await supabase
      .from('test_responses')
      .upsert(unansweredRowsToInsert, {
        onConflict: 'question_id,student_id',
        ignoreDuplicates: true,
      })

    if (insertUnansweredError) {
      console.error('Error inserting unanswered open responses for auto-grade:', insertUnansweredError)
      return NextResponse.json({ error: 'Failed to save unanswered grades' }, { status: 500 })
    }
  }

  if (unansweredResponseIdsToGrade.size > 0) {
    const { error: unansweredUpdateError } = await supabase
      .from('test_responses')
      .update({
        score: 0,
        feedback: 'Unanswered',
        graded_at: new Date().toISOString(),
        graded_by: user.id,
      })
      .eq('test_id', testId)
      .in('id', Array.from(unansweredResponseIdsToGrade))

    if (unansweredUpdateError) {
      console.error('Error grading unanswered open responses for auto-grade:', unansweredUpdateError)
      return NextResponse.json({ error: 'Failed to save unanswered grades' }, { status: 500 })
    }
  }

  const queue: GradeTask[] = []
  for (const studentId of studentIds) {
    queue.push(...(tasksByStudent.get(studentId) || []))
  }

  const eligibleStudentIds = new Set(
    studentIds.filter((studentId) => submittedAtByStudent.has(studentId))
  )

  let gradedResponses = unansweredRowsToInsert.length + unansweredResponseIdsToGrade.size + cachedGradeCount
  const errors: string[] = []

  async function runWorker() {
    while (queue.length > 0) {
      const task = queue.shift()
      if (!task) return

      try {
        const suggestion = await suggestTestOpenResponseGrade({
          testTitle,
          questionText: task.questionText,
          responseText: task.responseText,
          maxPoints: task.maxPoints,
          responseMonospace: task.responseMonospace,
          answerKey: task.answerKey,
          promptGuidelineOverride,
        })

        const { error: updateError } = await supabase
          .from('test_responses')
          .update({
            score: suggestion.score,
            feedback: suggestion.feedback,
            graded_at: new Date().toISOString(),
            graded_by: user.id,
            ai_model: suggestion.model,
            ai_grading_basis: suggestion.grading_basis,
            ai_reference_answers: suggestion.reference_answers,
          })
          .eq('id', task.responseId)
          .eq('test_id', testId)

        if (updateError) {
          throw new Error(updateError.message || 'Failed to save AI grade')
        }

        gradedResponses += 1
        completedQuestionsByStudent.set(
          task.studentId,
          (completedQuestionsByStudent.get(task.studentId) || 0) + 1
        )
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

  const gradedStudentIds = Array.from(eligibleStudentIds).filter((studentId) => {
    if (failedStudentIds.has(studentId)) return false
    return (completedQuestionsByStudent.get(studentId) || 0) >= openQuestionIds.length
  })

  const gradedStudents = gradedStudentIds.length
  const skippedStudents = studentIds.length - gradedStudents

  return NextResponse.json({
    graded_students: gradedStudents,
    skipped_students: skippedStudents,
    eligible_students: eligibleStudentIds.size,
    graded_responses: gradedResponses,
    errors: errors.length > 0 ? errors.slice(0, 20) : undefined,
  })
})
