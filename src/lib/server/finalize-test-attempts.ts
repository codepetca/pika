import { normalizeTestResponses } from '@/lib/test-attempts'

type SupabaseLike = any

type FinalizeResult =
  | {
      ok: true
      finalized_attempts: number
      inserted_responses: number
    }
  | {
      ok: false
      status: number
      error: string
    }

type TestQuestionRow = {
  id: string
  question_type: 'multiple_choice' | 'open_response'
  correct_option: number | null
  points: number | string | null
}

type TestAttemptRow = {
  id: string
  student_id: string
  responses: unknown
}

export async function finalizeUnsubmittedTestAttemptsOnClose(
  supabase: SupabaseLike,
  testId: string
): Promise<FinalizeResult> {
  const now = new Date().toISOString()

  const { data: questionRows, error: questionError } = await supabase
    .from('test_questions')
    .select('id, question_type, correct_option, points')
    .eq('test_id', testId)

  if (questionError) {
    console.error('Error loading test questions for close finalization:', questionError)
    return { ok: false, status: 500, error: 'Failed to finalize test submissions' }
  }

  const questions = (questionRows || []) as TestQuestionRow[]

  const { data: attemptRows, error: attemptError } = await supabase
    .from('test_attempts')
    .select('id, student_id, responses')
    .eq('test_id', testId)
    .eq('is_submitted', false)

  if (attemptError?.code === 'PGRST205') {
    return { ok: false, status: 400, error: 'Tests require migration 039 to be applied' }
  }

  if (attemptError) {
    console.error('Error loading test attempts for close finalization:', attemptError)
    return { ok: false, status: 500, error: 'Failed to finalize test submissions' }
  }

  const attempts = (attemptRows || []) as TestAttemptRow[]
  if (attempts.length === 0) {
    return { ok: true, finalized_attempts: 0, inserted_responses: 0 }
  }

  const studentIds = Array.from(new Set(attempts.map((attempt) => attempt.student_id)))
  const { data: existingRows, error: existingError } = await supabase
    .from('test_responses')
    .select('student_id, question_id')
    .eq('test_id', testId)
    .in('student_id', studentIds)

  if (existingError) {
    console.error('Error loading existing test responses for close finalization:', existingError)
    return { ok: false, status: 500, error: 'Failed to finalize test submissions' }
  }

  const existingKeys = new Set(
    (existingRows || []).map((row: { student_id: string; question_id: string }) => `${row.student_id}:${row.question_id}`)
  )

  const responseRows: Array<{
    test_id: string
    question_id: string
    student_id: string
    selected_option: number | null
    response_text: string | null
    score: number | null
    feedback: string | null
    graded_at: string | null
    graded_by: string | null
    submitted_at: string
  }> = []

  for (const attempt of attempts) {
    const normalizedResponses = normalizeTestResponses(attempt.responses)

    for (const question of questions) {
      const response = normalizedResponses[question.id]
      if (!response) continue

      const existingKey = `${attempt.student_id}:${question.id}`
      if (existingKeys.has(existingKey)) continue

      if (question.question_type === 'open_response') {
        if (response.question_type !== 'open_response') continue
        if (!response.response_text.trim()) continue

        responseRows.push({
          test_id: testId,
          question_id: question.id,
          student_id: attempt.student_id,
          selected_option: null,
          response_text: response.response_text,
          score: null,
          feedback: null,
          graded_at: null,
          graded_by: null,
          submitted_at: now,
        })
        continue
      }

      if (response.question_type !== 'multiple_choice') continue

      const selectedOption = response.selected_option
      if (!Number.isInteger(selectedOption) || selectedOption < 0) continue

      const points = Number(question.points ?? 1)
      const isCorrect = selectedOption === question.correct_option

      responseRows.push({
        test_id: testId,
        question_id: question.id,
        student_id: attempt.student_id,
        selected_option: selectedOption,
        response_text: null,
        score: isCorrect ? points : 0,
        feedback: null,
        graded_at: now,
        graded_by: null,
        submitted_at: now,
      })
    }
  }

  if (responseRows.length > 0) {
    const { error: insertError } = await supabase
      .from('test_responses')
      .upsert(responseRows, {
        onConflict: 'question_id,student_id',
        ignoreDuplicates: true,
      })

    if (insertError) {
      console.error('Error inserting finalized test responses:', insertError)
      return { ok: false, status: 500, error: 'Failed to finalize test submissions' }
    }
  }

  const attemptIds = attempts.map((attempt) => attempt.id)
  const { error: updateAttemptError } = await supabase
    .from('test_attempts')
    .update({
      is_submitted: true,
      submitted_at: now,
    })
    .in('id', attemptIds)

  if (updateAttemptError) {
    console.error('Error marking test attempts submitted during close finalization:', updateAttemptError)
    return { ok: false, status: 500, error: 'Failed to finalize test submissions' }
  }

  return {
    ok: true,
    finalized_attempts: attempts.length,
    inserted_responses: responseRows.length,
  }
}
