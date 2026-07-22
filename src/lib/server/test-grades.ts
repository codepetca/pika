import { z } from 'zod'
import { ApiError, apiErrors } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import type { Json } from '@/types/database.generated'
import type { TestGradingProvenance } from '@/lib/grading/contracts'
import { verifyManualTestAiProvenanceToken } from '@/lib/server/test-ai-provenance'
import type {
  SaveStudentTestGradesInput,
  SaveTestResponseGradeInput,
} from '@/lib/validations/test-grading'

const savedResponseSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().positive(),
  score: z.number().nullable(),
  feedback: z.string().nullable(),
})

const saveResultSchema = z.object({
  saved_count: z.number().int().nonnegative(),
  cleared_count: z.number().int().nonnegative(),
  responses: z.array(savedResponseSchema),
})

const clearResultSchema = z.object({
  cleared_students: z.number().int().nonnegative(),
  skipped_students: z.number().int().nonnegative(),
  cleared_responses: z.number().int().nonnegative(),
})

const finalizeResultSchema = z.object({
  outcome: z.enum(['saved', 'replayed', 'stale']),
  response: savedResponseSchema.nullable(),
})

type RpcError = { code?: string; message: string }

export class TestAiGradingLeaseLostError extends Error {
  constructor(message = 'Test AI grading lease changed; stop this worker') {
    super(message)
    this.name = 'TestAiGradingLeaseLostError'
  }
}

function throwGradeRpcError(error: RpcError, fallback: string): never {
  if (error.code === '42501') throw new ApiError(403, error.message)
  if (error.code === '40001') throw apiErrors.conflict(error.message)
  if (error.code === 'P0002') throw apiErrors.notFound(error.message)
  if (error.code === '22023' || error.code === '22P02') {
    throw apiErrors.badRequest(error.message)
  }
  throw new ApiError(500, fallback)
}

function toRpcGrade(
  grade: SaveStudentTestGradesInput['grades'][number] | SaveTestResponseGradeInput,
  identity: { responseId?: string; questionId?: string } = {},
) {
  const aiMetadata = grade.ai_grading_basis === undefined
    ? {}
    : {
        ai_grading_basis: grade.ai_grading_basis,
        ai_reference_answers: grade.ai_reference_answers ?? null,
        ai_model: grade.ai_model ?? null,
        ai_suggested_score: grade.ai_suggested_score ?? null,
        ai_suggested_feedback: grade.ai_suggested_feedback ?? null,
        ai_grading_provenance: grade.ai_grading_provenance ?? null,
        question_grading_snapshot: grade.question_grading_snapshot ?? null,
      }
  return {
    response_id: identity.responseId ?? ('response_id' in grade ? grade.response_id : null),
    question_id: identity.questionId ?? ('question_id' in grade ? grade.question_id : null),
    expected_response_revision: grade.expected_response_revision,
    clear_grade: grade.clear_grade,
    score: grade.score,
    feedback: grade.feedback,
    ...aiMetadata,
  }
}

function assertManualAiProvenance(input: {
  teacherId: string
  testId: string
  responseId: string
  grade: SaveStudentTestGradesInput['grades'][number] | SaveTestResponseGradeInput
}) {
  const { grade } = input
  if (!grade.ai_grading_basis) return
  if (
    !grade.ai_model ||
    !grade.question_grading_snapshot ||
    !grade.ai_provenance_token ||
    grade.ai_suggested_score == null ||
    grade.ai_suggested_feedback == null ||
    !verifyManualTestAiProvenanceToken({
      token: grade.ai_provenance_token,
      expected: {
        teacherId: input.teacherId,
        testId: input.testId,
        responseId: input.responseId,
        responseRevision: grade.expected_response_revision,
        gradingBasis: grade.ai_grading_basis,
        referenceAnswers:
          grade.ai_grading_basis === 'generated_reference'
            ? grade.ai_reference_answers ?? null
            : null,
        model: grade.ai_model,
        suggestedScore: grade.ai_suggested_score,
        suggestedFeedback: grade.ai_suggested_feedback,
        questionGradingSnapshot: grade.question_grading_snapshot,
        gradingProvenance: grade.ai_grading_provenance ?? null,
      },
    })
  ) {
    throw apiErrors.badRequest('AI grading provenance is invalid or expired')
  }
}

async function saveGrades(opts: {
  teacherId: string
  testId: string
  studentId: string | null
  gradeRows: ReturnType<typeof toRpcGrade>[]
  now?: string
}) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('save_test_response_grades_with_provenance_atomic', {
    p_test_id: opts.testId,
    p_student_id: opts.studentId,
    p_teacher_id: opts.teacherId,
    p_grade_rows: opts.gradeRows,
    p_now: opts.now ?? new Date().toISOString(),
  })

  if (error) throwGradeRpcError(error, 'Failed to save test grades')

  const parsed = saveResultSchema.safeParse(data)
  if (!parsed.success || parsed.data.responses.length !== opts.gradeRows.length) {
    throw new ApiError(500, 'Invalid test grade save result')
  }
  return parsed.data
}

export async function saveStudentTestGrades(input: {
  teacherId: string
  testId: string
  studentId: string
  grades: SaveStudentTestGradesInput['grades']
  now?: string
}) {
  for (const grade of input.grades) {
    assertManualAiProvenance({
      teacherId: input.teacherId,
      testId: input.testId,
      responseId: grade.response_id,
      grade,
    })
  }
  const result = await saveGrades({
    teacherId: input.teacherId,
    testId: input.testId,
    studentId: input.studentId,
    gradeRows: input.grades.map((grade) => toRpcGrade(grade)),
    now: input.now,
  })
  return {
    savedCount: result.saved_count,
    clearedCount: result.cleared_count,
    responses: result.responses,
  }
}

export async function saveTestResponseGrade(input: {
  teacherId: string
  testId: string
  responseId: string
  grade: SaveTestResponseGradeInput
  now?: string
}) {
  assertManualAiProvenance({
    teacherId: input.teacherId,
    testId: input.testId,
    responseId: input.responseId,
    grade: input.grade,
  })
  const result = await saveGrades({
    teacherId: input.teacherId,
    testId: input.testId,
    studentId: null,
    gradeRows: [toRpcGrade(input.grade, { responseId: input.responseId })],
    now: input.now,
  })
  return result.responses[0]
}

export async function clearTestOpenResponseGrades(input: {
  teacherId: string
  testId: string
  studentIds: string[]
  expectedResponses: Array<{ response_id: string; expected_response_revision: number }>
  now?: string
}) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('clear_test_open_response_grades_atomic', {
    p_test_id: input.testId,
    p_teacher_id: input.teacherId,
    p_student_ids: input.studentIds,
    p_expected_responses: input.expectedResponses,
    p_now: input.now ?? new Date().toISOString(),
  })

  if (error) throwGradeRpcError(error, 'Failed to clear open-response grades')

  const parsed = clearResultSchema.safeParse(data)
  if (!parsed.success) throw new ApiError(500, 'Invalid test grade clear result')
  return {
    clearedStudents: parsed.data.cleared_students,
    skippedStudents: parsed.data.skipped_students,
    clearedResponses: parsed.data.cleared_responses,
  }
}

export async function setTestAiGradingItemState(input: {
  itemId: string
  leaseToken: string
  status: 'queued' | 'processing' | 'failed'
  attemptCount: number
  nextRetryAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  questionGradingSnapshot: Json | null
}) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('set_test_ai_grading_item_state_atomic', {
    p_item_id: input.itemId,
    p_lease_token: input.leaseToken,
    p_status: input.status,
    p_attempt_count: input.attemptCount,
    p_next_retry_at: input.nextRetryAt,
    p_last_error_code: input.lastErrorCode,
    p_last_error_message: input.lastErrorMessage,
    p_started_at: input.startedAt,
    p_completed_at: input.completedAt,
    p_question_grading_snapshot: input.questionGradingSnapshot,
  })

  if (error?.code === '40001' || error?.code === 'P0002') {
    throw new TestAiGradingLeaseLostError(error.message)
  }
  if (error || data !== true) {
    throw new Error(error?.message || 'Failed to update test AI grading run item')
  }
}

export async function renewTestAiGradingRunLease(input: {
  runId: string
  leaseToken: string
  leaseSeconds: number
}) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('renew_test_ai_grading_run_lease', {
    p_run_id: input.runId,
    p_lease_token: input.leaseToken,
    p_lease_seconds: input.leaseSeconds,
  })
  if (error?.code === '40001' || (!error && data !== true)) {
    throw new TestAiGradingLeaseLostError(error?.message)
  }
  if (error) throw new Error(error.message || 'Failed to renew test AI grading lease')
}

export async function finalizeTestAiGradingItem(input: {
  itemId: string
  teacherId: string
  leaseToken: string
  score: number
  feedback: string
  aiGradingBasis: 'teacher_key' | 'generated_reference'
  aiReferenceAnswers: string[] | null
  aiModel: string
  aiGradingProvenance: TestGradingProvenance
  attemptCount: number
  now?: string
}) {
  const supabase = getServiceRoleClient()
  const { data, error } = await supabase.rpc('finalize_test_ai_grading_item_with_provenance_atomic', {
    p_item_id: input.itemId,
    p_teacher_id: input.teacherId,
    p_lease_token: input.leaseToken,
    p_score: input.score,
    p_feedback: input.feedback,
    p_ai_grading_basis: input.aiGradingBasis,
    p_ai_reference_answers: input.aiReferenceAnswers,
    p_ai_model: input.aiModel,
    p_ai_grading_provenance: input.aiGradingProvenance,
    p_attempt_count: input.attemptCount,
    p_now: input.now ?? new Date().toISOString(),
  })

  if (error?.code === '40001' || error?.code === 'P0002') {
    throw new TestAiGradingLeaseLostError(error.message)
  }
  if (error) throw new Error(error.message || 'Failed to finalize test AI grade')

  const parsed = finalizeResultSchema.safeParse(data)
  if (!parsed.success || (parsed.data.outcome !== 'stale' && !parsed.data.response)) {
    throw new Error('Invalid test AI grade finalization result')
  }
  return parsed.data
}
