import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest, isMissingTestResponseAiColumnsError } from '@/lib/server/tests'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type GradePayload = {
  question_id: string
  score: number | null
  feedback: string | null
  clear_grade: boolean
  ai_grading_basis?: 'teacher_key' | 'generated_reference' | null
  ai_reference_answers?: string[] | null
  ai_model?: string | null
}

function normalizeGradePayload(raw: unknown): GradePayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  const questionId = typeof record.question_id === 'string' ? record.question_id.trim() : ''
  const clearGrade = record.clear_grade === true
  if (!questionId) return null
  if (record.clear_grade !== undefined && typeof record.clear_grade !== 'boolean') return null

  let score: number | null = null
  let feedback: string | null = null
  if (!clearGrade) {
    const parsedScore = Number(record.score)
    if (!Number.isFinite(parsedScore) || parsedScore < 0) return null
    score = Math.round(parsedScore * 100) / 100
    const normalizedFeedback = typeof record.feedback === 'string' ? record.feedback.trim() : ''
    feedback = normalizedFeedback || null
  }

  let aiGradingBasis: 'teacher_key' | 'generated_reference' | null | undefined
  if (record.ai_grading_basis !== undefined) {
    if (record.ai_grading_basis === null) {
      aiGradingBasis = null
    } else if (
      record.ai_grading_basis === 'teacher_key' ||
      record.ai_grading_basis === 'generated_reference'
    ) {
      aiGradingBasis = record.ai_grading_basis
    } else {
      return null
    }
  }

  let aiReferenceAnswers: string[] | null | undefined
  if (record.ai_reference_answers !== undefined) {
    if (record.ai_reference_answers === null) {
      aiReferenceAnswers = null
    } else if (Array.isArray(record.ai_reference_answers)) {
      const normalized = record.ai_reference_answers
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0)
      if (normalized.length === 0 || normalized.length > 3) return null
      aiReferenceAnswers = normalized
    } else {
      return null
    }
  }

  let aiModel: string | null | undefined
  if (record.ai_model !== undefined) {
    if (record.ai_model === null) {
      aiModel = null
    } else if (typeof record.ai_model === 'string') {
      aiModel = record.ai_model.trim() || null
    } else {
      return null
    }
  }

  if (aiGradingBasis === 'generated_reference' && (!aiReferenceAnswers || aiReferenceAnswers.length === 0)) {
    return null
  }
  if (aiGradingBasis === 'teacher_key') {
    aiReferenceAnswers = null
  }

  return {
    question_id: questionId,
    score,
    feedback,
    clear_grade: clearGrade,
    ai_grading_basis: aiGradingBasis,
    ai_reference_answers: aiReferenceAnswers,
    ai_model: aiModel,
  }
}

// PATCH /api/teacher/tests/[id]/students/[studentId]/grades - Save open-response grades for one student
export const PATCH = withErrorHandler('BulkSaveTeacherTestGrades', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, studentId } = await context.params
  const body = (await request.json()) as Record<string, unknown>

  if (!Array.isArray(body.grades) || body.grades.length === 0) {
    return NextResponse.json({ error: 'grades array is required' }, { status: 400 })
  }

  const grades: GradePayload[] = []
  for (const raw of body.grades) {
    const normalized = normalizeGradePayload(raw)
    if (!normalized) {
      return NextResponse.json({ error: 'Invalid grade payload' }, { status: 400 })
    }
    grades.push(normalized)
  }

  const dedupedQuestionIds = new Set<string>()
  for (const grade of grades) {
    if (dedupedQuestionIds.has(grade.question_id)) {
      return NextResponse.json({ error: 'Duplicate question_id in grades payload' }, { status: 400 })
    }
    dedupedQuestionIds.add(grade.question_id)
  }

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()

  const { data: enrollment, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', access.test.classroom_id)
    .eq('student_id', studentId)
    .maybeSingle()

  if (enrollmentError) {
    console.error('Error validating classroom enrollment for grade save:', enrollmentError)
    return NextResponse.json({ error: 'Failed to validate student enrollment' }, { status: 500 })
  }
  if (!enrollment) {
    return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 400 })
  }

  const questionIds = grades.map((grade) => grade.question_id)

  const { data: questionRows, error: questionError } = await supabase
    .from('test_questions')
    .select('id, question_type, points')
    .eq('test_id', testId)
    .in('id', questionIds)

  if (questionError) {
    console.error('Error loading test questions for grade save:', questionError)
    return NextResponse.json({ error: 'Failed to validate questions' }, { status: 500 })
  }

  if ((questionRows || []).length !== questionIds.length) {
    return NextResponse.json({ error: 'One or more questions were not found for this test' }, { status: 400 })
  }

  const questionMap = new Map((questionRows || []).map((row) => [row.id, row]))
  for (const grade of grades) {
    const question = questionMap.get(grade.question_id)
    if (!question) {
      return NextResponse.json({ error: 'One or more questions were not found for this test' }, { status: 400 })
    }
    const maxScore = Number(question.points ?? 0)
    if (grade.score != null && grade.score > maxScore) {
      return NextResponse.json({ error: `score cannot exceed ${maxScore}` }, { status: 400 })
    }
    if (question.question_type !== 'open_response' && grade.ai_grading_basis !== undefined) {
      return NextResponse.json(
        { error: 'AI grading metadata is only supported for open-response questions' },
        { status: 400 },
      )
    }
  }

  const { data: existingRows, error: existingRowsError } = await supabase
    .from('test_responses')
    .select('question_id, selected_option, response_text, submitted_at')
    .eq('test_id', testId)
    .eq('student_id', studentId)
    .in('question_id', questionIds)

  if (existingRowsError) {
    console.error('Error loading existing responses for grade save:', existingRowsError)
    return NextResponse.json({ error: 'Failed to save grades' }, { status: 500 })
  }

  const existingByQuestionId = new Map((existingRows || []).map((row) => [row.question_id, row]))
  const gradedAt = new Date().toISOString()

  const upsertRows = grades.map((grade) => {
    const existing = existingByQuestionId.get(grade.question_id)
    const question = questionMap.get(grade.question_id)!
    const responseText =
      typeof existing?.response_text === 'string'
        ? existing.response_text
        : question.question_type === 'open_response'
          ? ''
          : null
    const submittedAt =
      typeof existing?.submitted_at === 'string' && existing.submitted_at
        ? existing.submitted_at
        : gradedAt
    const selectedOption =
      typeof existing?.selected_option === 'number'
        ? existing.selected_option
        : null

    if (grade.clear_grade) {
      return {
        test_id: testId,
        question_id: grade.question_id,
        student_id: studentId,
        selected_option: selectedOption,
        response_text: responseText,
        score: null,
        feedback: null,
        graded_at: null,
        graded_by: null,
        submitted_at: submittedAt,
        ai_grading_basis: null,
        ai_reference_answers: null,
        ai_model: null,
      }
    }

    return {
      test_id: testId,
      question_id: grade.question_id,
      student_id: studentId,
      selected_option: selectedOption,
      response_text: responseText,
      score: grade.score,
      feedback: question.question_type === 'open_response' ? grade.feedback : null,
      graded_at: gradedAt,
      graded_by: user.id,
      submitted_at: submittedAt,
      ai_grading_basis:
        question.question_type === 'open_response'
          ? (grade.ai_grading_basis ?? null)
          : null,
      ai_reference_answers:
        question.question_type === 'open_response' && grade.ai_grading_basis === 'generated_reference'
          ? (grade.ai_reference_answers ?? [])
          : null,
      ai_model: question.question_type === 'open_response' ? (grade.ai_model ?? null) : null,
    }
  })

  let upsertError: { code?: string; message?: string; details?: string; hint?: string } | null = null
  {
    const upsertWithAiResult = await supabase
      .from('test_responses')
      .upsert(upsertRows, { onConflict: 'question_id,student_id' })

    upsertError = upsertWithAiResult.error
  }

  if (upsertError && isMissingTestResponseAiColumnsError(upsertError)) {
    const legacyUpsertRows = upsertRows.map((row) => ({
      test_id: row.test_id,
      question_id: row.question_id,
      student_id: row.student_id,
      selected_option: row.selected_option,
      response_text: row.response_text,
      score: row.score,
      feedback: row.feedback,
      graded_at: row.graded_at,
      graded_by: row.graded_by,
      submitted_at: row.submitted_at,
    }))

    const legacyUpsertResult = await supabase
      .from('test_responses')
      .upsert(legacyUpsertRows, { onConflict: 'question_id,student_id' })

    upsertError = legacyUpsertResult.error
  }

  if (upsertError) {
    console.error('Error upserting student grade set:', upsertError)
    return NextResponse.json({ error: 'Failed to save grades' }, { status: 500 })
  }

  return NextResponse.json({
    saved_count: upsertRows.length,
  })
})
