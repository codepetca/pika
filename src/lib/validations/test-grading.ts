import { z } from 'zod'
import {
  testQuestionGradingSnapshotSchema,
  type TestQuestionGradingSnapshot,
} from '@/lib/test-grading-context'

type ParsedGrade = {
  score: number | null
  feedback: string | null
  clear_grade: boolean
  ai_grading_basis: 'teacher_key' | 'generated_reference' | null | undefined
  ai_reference_answers: string[] | null | undefined
  ai_model: string | null | undefined
  question_grading_snapshot: TestQuestionGradingSnapshot | null | undefined
  ai_provenance_token: string | null | undefined
  ai_suggested_score: number | null | undefined
  ai_suggested_feedback: string | null | undefined
}

function invalidGrade(context: z.RefinementCtx): never {
  context.addIssue({ code: 'custom', message: 'Invalid grade payload' })
  return z.NEVER
}

function parseGrade(raw: unknown, context: z.RefinementCtx): ParsedGrade | never {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return invalidGrade(context)
  }

  const record = raw as Record<string, unknown>
  const clearGrade = record.clear_grade === true
  if (record.clear_grade !== undefined && typeof record.clear_grade !== 'boolean') {
    return invalidGrade(context)
  }

  if (clearGrade) {
    return {
      score: null,
      feedback: null,
      clear_grade: true,
      ai_grading_basis: null,
      ai_reference_answers: null,
      ai_model: null,
      question_grading_snapshot: null,
      ai_provenance_token: null,
      ai_suggested_score: null,
      ai_suggested_feedback: null,
    }
  }

  if (typeof record.score !== 'number' || !Number.isFinite(record.score) || record.score < 0) {
    return invalidGrade(context)
  }
  if (
    record.feedback !== undefined &&
    (typeof record.feedback !== 'string' || record.feedback.length > 10000)
  ) {
    return invalidGrade(context)
  }

  const score = Math.round(record.score * 100) / 100
  const feedback = typeof record.feedback === 'string' ? record.feedback.trim() || null : null

  let aiGradingBasis: 'teacher_key' | 'generated_reference' | null | undefined
  if (record.ai_grading_basis !== undefined) {
    if (
      record.ai_grading_basis !== null &&
      record.ai_grading_basis !== 'teacher_key' &&
      record.ai_grading_basis !== 'generated_reference'
    ) {
      return invalidGrade(context)
    }
    aiGradingBasis = record.ai_grading_basis
  }

  let aiReferenceAnswers: string[] | null | undefined
  if (record.ai_reference_answers !== undefined) {
    if (record.ai_reference_answers === null) {
      aiReferenceAnswers = null
    } else if (Array.isArray(record.ai_reference_answers)) {
      if (
        !record.ai_reference_answers.every(
          (value) => typeof value === 'string' && value.length <= 10000,
        )
      ) {
        return invalidGrade(context)
      }
      const normalized = record.ai_reference_answers
        .map((value) => value.trim())
        .filter(Boolean)
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
    } else if (typeof record.ai_model === 'string' && record.ai_model.length <= 200) {
      aiModel = record.ai_model.trim() || null
    } else {
      return invalidGrade(context)
    }
  }

  let questionGradingSnapshot: TestQuestionGradingSnapshot | null | undefined
  if (record.question_grading_snapshot !== undefined) {
    if (record.question_grading_snapshot === null) {
      questionGradingSnapshot = null
    } else {
      const parsedSnapshot = testQuestionGradingSnapshotSchema.safeParse(
        record.question_grading_snapshot,
      )
      if (!parsedSnapshot.success) return invalidGrade(context)
      questionGradingSnapshot = parsedSnapshot.data
    }
  }

  let aiProvenanceToken: string | null | undefined
  if (record.ai_provenance_token !== undefined) {
    if (record.ai_provenance_token === null) {
      aiProvenanceToken = null
    } else if (
      typeof record.ai_provenance_token === 'string' &&
      record.ai_provenance_token.length <= 16384
    ) {
      aiProvenanceToken = record.ai_provenance_token.trim() || null
    } else {
      return invalidGrade(context)
    }
  }

  let aiSuggestedScore: number | null | undefined
  if (record.ai_suggested_score !== undefined) {
    if (record.ai_suggested_score === null) {
      aiSuggestedScore = null
    } else if (
      typeof record.ai_suggested_score === 'number' &&
      Number.isFinite(record.ai_suggested_score) &&
      record.ai_suggested_score >= 0
    ) {
      aiSuggestedScore = Math.round(record.ai_suggested_score * 100) / 100
    } else {
      return invalidGrade(context)
    }
  }

  let aiSuggestedFeedback: string | null | undefined
  if (record.ai_suggested_feedback !== undefined) {
    if (record.ai_suggested_feedback === null) {
      aiSuggestedFeedback = null
    } else if (
      typeof record.ai_suggested_feedback === 'string' &&
      record.ai_suggested_feedback.length <= 10000
    ) {
      aiSuggestedFeedback = record.ai_suggested_feedback
    } else {
      return invalidGrade(context)
    }
  }

  if (aiGradingBasis === null) {
    aiReferenceAnswers = null
    aiModel = null
    questionGradingSnapshot = null
    aiProvenanceToken = null
    aiSuggestedScore = null
    aiSuggestedFeedback = null
  } else {
    if (aiGradingBasis === undefined && Array.isArray(aiReferenceAnswers)) {
      aiGradingBasis = 'generated_reference'
    }
    if (
      (aiGradingBasis === undefined && aiModel !== undefined) ||
      (aiGradingBasis === undefined && questionGradingSnapshot !== undefined) ||
      (aiGradingBasis === undefined && aiProvenanceToken !== undefined) ||
      (aiGradingBasis === undefined && aiSuggestedScore !== undefined) ||
      (aiGradingBasis === undefined && aiSuggestedFeedback !== undefined) ||
      (aiGradingBasis !== undefined && aiGradingBasis !== null && !aiModel) ||
      (aiGradingBasis !== undefined && aiGradingBasis !== null && !questionGradingSnapshot) ||
      (aiGradingBasis !== undefined && aiGradingBasis !== null && !aiProvenanceToken) ||
      (aiGradingBasis !== undefined && aiGradingBasis !== null && aiSuggestedScore == null) ||
      (aiGradingBasis !== undefined && aiGradingBasis !== null && aiSuggestedFeedback == null) ||
      (aiGradingBasis === 'generated_reference' && !aiReferenceAnswers)
    ) {
      return invalidGrade(context)
    }
    if (aiGradingBasis === 'teacher_key') {
      aiReferenceAnswers = null
    }
  }

  return {
    score,
    feedback,
    clear_grade: false,
    ai_grading_basis: aiGradingBasis,
    ai_reference_answers: aiReferenceAnswers,
    ai_model: aiModel,
    question_grading_snapshot: questionGradingSnapshot,
    ai_provenance_token: aiProvenanceToken,
    ai_suggested_score: aiSuggestedScore,
    ai_suggested_feedback: aiSuggestedFeedback,
  }
}

export const saveTestResponseGradeSchema = z.unknown().transform((raw, context) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalidGrade(context)
  const record = raw as Record<string, unknown>
  if (
    typeof record.expected_response_revision !== 'number' ||
    !Number.isSafeInteger(record.expected_response_revision) ||
    record.expected_response_revision < 1
  ) {
    return invalidGrade(context)
  }

  const grade = parseGrade(raw, context)
  if (grade === z.NEVER) return z.NEVER
  return { expected_response_revision: record.expected_response_revision, ...grade }
})

const studentTestGradeSchema = z.unknown().transform((raw, context) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalidGrade(context)
  const record = raw as Record<string, unknown>
  const questionId = typeof record.question_id === 'string' ? record.question_id.trim() : ''
  const responseId = typeof record.response_id === 'string' ? record.response_id.trim() : ''
  if (!questionId || !responseId) return invalidGrade(context)
  if (
    typeof record.expected_response_revision !== 'number' ||
    !Number.isSafeInteger(record.expected_response_revision) ||
    record.expected_response_revision < 1
  ) {
    return invalidGrade(context)
  }

  const grade = parseGrade(raw, context)
  if (grade === z.NEVER) return z.NEVER
  return {
    question_id: questionId,
    response_id: responseId,
    expected_response_revision: record.expected_response_revision,
    ...grade,
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
  if (gradesValue.length > 100) return invalidGrade(context)

  const grades: StudentTestGradeInput[] = []
  for (const gradeValue of gradesValue) {
    const parsed = studentTestGradeSchema.safeParse(gradeValue)
    if (!parsed.success) return invalidGrade(context)
    grades.push(parsed.data)
  }

  const questionIds = new Set<string>()
  const responseIds = new Set<string>()
  for (const grade of grades) {
    if (questionIds.has(grade.question_id)) {
      context.addIssue({ code: 'custom', message: 'Duplicate question_id in grades payload' })
      return z.NEVER
    }
    if (responseIds.has(grade.response_id)) {
      context.addIssue({ code: 'custom', message: 'Duplicate response_id in grades payload' })
      return z.NEVER
    }
    questionIds.add(grade.question_id)
    responseIds.add(grade.response_id)
  }

  return { grades }
})

export const clearTestOpenGradesSchema = z.unknown().transform((raw, context) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    context.addIssue({ code: 'custom', message: 'student_ids array is required' })
    return z.NEVER
  }
  const value = (raw as Record<string, unknown>).student_ids
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    context.addIssue({ code: 'custom', message: 'student_ids array is required' })
    return z.NEVER
  }
  if (!value.every((studentId) => typeof studentId === 'string' && studentId.trim())) {
    context.addIssue({ code: 'custom', message: 'student_ids must contain non-empty strings' })
    return z.NEVER
  }
  const studentIds = Array.from(new Set(value.map((studentId) => studentId.trim())))
  if (studentIds.length > 100) {
    context.addIssue({ code: 'custom', message: 'Cannot clear grades for more than 100 students at once' })
    return z.NEVER
  }
  const responsesValue = (raw as Record<string, unknown>).responses
  if (!Array.isArray(responsesValue) || responsesValue.length > 1000) {
    context.addIssue({ code: 'custom', message: 'responses array is required' })
    return z.NEVER
  }
  const responses: Array<{ response_id: string; expected_response_revision: number }> = []
  const responseIds = new Set<string>()
  for (const responseValue of responsesValue) {
    if (!responseValue || typeof responseValue !== 'object' || Array.isArray(responseValue)) {
      context.addIssue({ code: 'custom', message: 'responses must contain response revisions' })
      return z.NEVER
    }
    const response = responseValue as Record<string, unknown>
    const responseId = typeof response.response_id === 'string' ? response.response_id.trim() : ''
    const revision = response.expected_response_revision
    if (!responseId || !Number.isSafeInteger(revision) || (revision as number) < 1) {
      context.addIssue({ code: 'custom', message: 'responses must contain response revisions' })
      return z.NEVER
    }
    if (responseIds.has(responseId)) {
      context.addIssue({ code: 'custom', message: 'Duplicate response_id in responses payload' })
      return z.NEVER
    }
    responseIds.add(responseId)
    responses.push({ response_id: responseId, expected_response_revision: revision as number })
  }
  return { student_ids: studentIds, responses }
})

export type SaveStudentTestGradesInput = z.infer<typeof saveStudentTestGradesSchema>
export type SaveTestResponseGradeInput = z.infer<typeof saveTestResponseGradeSchema>
export type ClearTestOpenGradesInput = z.infer<typeof clearTestOpenGradesSchema>
