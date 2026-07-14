import { z } from 'zod'

function invalidGrade(context: z.RefinementCtx): never {
  context.addIssue({ code: 'custom', message: 'Invalid grade payload' })
  return z.NEVER
}

const studentTestGradeSchema = z.unknown().transform((raw, context) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalidGrade(context)
  }

  const record = raw as Record<string, unknown>
  const questionId = typeof record.question_id === 'string' ? record.question_id.trim() : ''
  const clearGrade = record.clear_grade === true
  if (!questionId) return invalidGrade(context)
  if (record.clear_grade !== undefined && typeof record.clear_grade !== 'boolean') {
    return invalidGrade(context)
  }

  let score: number | null = null
  let feedback: string | null = null
  if (!clearGrade) {
    let parsedScore: number
    try {
      parsedScore = Number(record.score)
    } catch {
      return invalidGrade(context)
    }
    if (!Number.isFinite(parsedScore) || parsedScore < 0) return invalidGrade(context)
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
      return invalidGrade(context)
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
      if (normalized.length === 0 || normalized.length > 3) return invalidGrade(context)
      aiReferenceAnswers = normalized
    } else {
      return invalidGrade(context)
    }
  }

  let aiModel: string | null | undefined
  if (record.ai_model !== undefined) {
    if (record.ai_model === null) {
      aiModel = null
    } else if (typeof record.ai_model === 'string') {
      aiModel = record.ai_model.trim() || null
    } else {
      return invalidGrade(context)
    }
  }

  if (
    aiGradingBasis === 'generated_reference' &&
    (!aiReferenceAnswers || aiReferenceAnswers.length === 0)
  ) {
    return invalidGrade(context)
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
})

export type StudentTestGradeInput = z.infer<typeof studentTestGradeSchema>

export const saveStudentTestGradesSchema = z.unknown().transform((raw, context) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    context.addIssue({ code: 'custom', message: 'grades array is required' })
    return z.NEVER
  }

  const gradesValue = (raw as Record<string, unknown>).grades
  if (!Array.isArray(gradesValue) || gradesValue.length === 0) {
    context.addIssue({ code: 'custom', message: 'grades array is required' })
    return z.NEVER
  }

  const grades: StudentTestGradeInput[] = []
  for (const gradeValue of gradesValue) {
    const parsed = studentTestGradeSchema.safeParse(gradeValue)
    if (!parsed.success) {
      context.addIssue({ code: 'custom', message: 'Invalid grade payload' })
      return z.NEVER
    }
    grades.push(parsed.data)
  }

  const questionIds = new Set<string>()
  for (const grade of grades) {
    if (questionIds.has(grade.question_id)) {
      context.addIssue({ code: 'custom', message: 'Duplicate question_id in grades payload' })
      return z.NEVER
    }
    questionIds.add(grade.question_id)
  }

  return { grades }
})

export type SaveStudentTestGradesInput = z.infer<typeof saveStudentTestGradesSchema>
