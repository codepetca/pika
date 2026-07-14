import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest, isMissingTestResponseAiColumnsError } from '@/lib/server/tests'
import type { SaveStudentTestGradesInput } from '@/lib/validations/test-grading'

type SaveStudentTestGradesResult =
  | { ok: true; savedCount: number }
  | { ok: false; status: number; error: string }

export async function saveStudentTestGrades(input: {
  teacherId: string
  testId: string
  studentId: string
  grades: SaveStudentTestGradesInput['grades']
}): Promise<SaveStudentTestGradesResult> {
  const access = await assertTeacherOwnsTest(input.teacherId, input.testId, { checkArchived: true })
  if (!access.ok) return access

  const supabase = getServiceRoleClient()
  const { data: enrollment, error: enrollmentError } = await supabase
    .from('classroom_enrollments')
    .select('student_id')
    .eq('classroom_id', access.test.classroom_id)
    .eq('student_id', input.studentId)
    .maybeSingle()

  if (enrollmentError) {
    console.error('Error validating classroom enrollment for grade save:', enrollmentError)
    return { ok: false, status: 500, error: 'Failed to validate student enrollment' }
  }
  if (!enrollment) {
    return { ok: false, status: 400, error: 'Student is not enrolled in this classroom' }
  }

  const questionIds = input.grades.map((grade) => grade.question_id)
  const { data: questionRows, error: questionError } = await supabase
    .from('test_questions')
    .select('id, question_type, points')
    .eq('test_id', input.testId)
    .in('id', questionIds)

  if (questionError) {
    console.error('Error loading test questions for grade save:', questionError)
    return { ok: false, status: 500, error: 'Failed to validate questions' }
  }

  if ((questionRows || []).length !== questionIds.length) {
    return { ok: false, status: 400, error: 'One or more questions were not found for this test' }
  }

  const questionMap = new Map((questionRows || []).map((row) => [row.id, row]))
  for (const grade of input.grades) {
    const question = questionMap.get(grade.question_id)
    if (!question) {
      return { ok: false, status: 400, error: 'One or more questions were not found for this test' }
    }
    const maxScore = Number(question.points ?? 0)
    if (grade.score != null && grade.score > maxScore) {
      return { ok: false, status: 400, error: `score cannot exceed ${maxScore}` }
    }
    if (question.question_type !== 'open_response' && grade.ai_grading_basis !== undefined) {
      return {
        ok: false,
        status: 400,
        error: 'AI grading metadata is only supported for open-response questions',
      }
    }
  }

  const { data: existingRows, error: existingRowsError } = await supabase
    .from('test_responses')
    .select('question_id, selected_option, response_text, submitted_at')
    .eq('test_id', input.testId)
    .eq('student_id', input.studentId)
    .in('question_id', questionIds)

  if (existingRowsError) {
    console.error('Error loading existing responses for grade save:', existingRowsError)
    return { ok: false, status: 500, error: 'Failed to save grades' }
  }

  const existingByQuestionId = new Map((existingRows || []).map((row) => [row.question_id, row]))
  const gradedAt = new Date().toISOString()
  const upsertRows = input.grades.map((grade) => {
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
        test_id: input.testId,
        question_id: grade.question_id,
        student_id: input.studentId,
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
      test_id: input.testId,
      question_id: grade.question_id,
      student_id: input.studentId,
      selected_option: selectedOption,
      response_text: responseText,
      score: grade.score,
      feedback: question.question_type === 'open_response' ? grade.feedback : null,
      graded_at: gradedAt,
      graded_by: input.teacherId,
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

  let upsertError: { code?: string; message?: string; details?: string; hint?: string } | null
  const upsertWithAiResult = await supabase
    .from('test_responses')
    .upsert(upsertRows, { onConflict: 'question_id,student_id' })
  upsertError = upsertWithAiResult.error

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
    return { ok: false, status: 500, error: 'Failed to save grades' }
  }

  return { ok: true, savedCount: upsertRows.length }
}
