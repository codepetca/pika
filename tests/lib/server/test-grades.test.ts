import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api-handler'
import {
  clearTestOpenResponseGrades,
  finalizeTestAiGradingItem,
  renewTestAiGradingRunLease,
  saveStudentTestGrades,
  saveTestResponseGrade,
  setTestAiGradingItemState,
  TestAiGradingLeaseLostError,
} from '@/lib/server/test-grades'
import { createManualTestAiProvenanceToken } from '@/lib/server/test-ai-provenance'

const questionGradingSnapshot = {
  test_title: 'Unit Test',
  question_text: 'Explain the result.',
  points: 5,
  response_monospace: false,
  answer_key: 'Expected result',
  sample_solution: null,
}

const gradingProvenance = {
  schemaVersion: 'test-grading-provenance-v1' as const,
  gradingRequestId: '10000000-0000-4000-8000-000000000001',
  provider: 'openai',
  model: 'gpt-5-nano',
  policyVersion: 'pika-test-open-response-policy-v1',
  promptVersion: 'pika-test-open-response-manual-prompt-v1',
  gradingProfileVersion: 'pika-test-open-response-v1',
  rubricVersion: 'pika-test-open-response-rubric-v1',
  operation: 'single' as const,
  batchSize: 1,
  providerRequestCount: 1,
  tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
}

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => ({ rpc })),
}))

const grade = {
  question_id: 'question-1',
  response_id: 'response-1',
  expected_response_revision: 2,
  score: 4,
  feedback: 'Good work',
  clear_grade: false,
  ai_grading_basis: undefined,
  ai_reference_answers: undefined,
  ai_model: undefined,
} as const

describe('test grade server workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough'
  })

  it('saves a revision-aware student grade batch through one RPC', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        saved_count: 1,
        cleared_count: 0,
        responses: [{ id: 'response-1', revision: 3, score: 4, feedback: 'Good work' }],
      },
      error: null,
    })

    await expect(saveStudentTestGrades({
      teacherId: 'teacher-1',
      testId: 'test-1',
      studentId: 'student-1',
      grades: [grade],
      now: '2026-07-14T23:00:00.000Z',
    })).resolves.toEqual({
      savedCount: 1,
      clearedCount: 0,
      responses: [{ id: 'response-1', revision: 3, score: 4, feedback: 'Good work' }],
    })

    expect(rpc).toHaveBeenCalledWith('save_test_response_grades_with_provenance_atomic', {
      p_grade_rows: [{
        ...grade,
      }],
      p_now: '2026-07-14T23:00:00.000Z',
      p_student_id: 'student-1',
      p_teacher_id: 'teacher-1',
      p_test_id: 'test-1',
    })
  })

  it('saves one response with the same atomic contract', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        saved_count: 1,
        cleared_count: 1,
        responses: [{ id: 'response-1', revision: 4, score: null, feedback: null }],
      },
      error: null,
    })

    await expect(saveTestResponseGrade({
      teacherId: 'teacher-1',
      testId: 'test-1',
      responseId: 'response-1',
      grade: {
        expected_response_revision: 3,
        score: null,
        feedback: null,
        clear_grade: true,
        ai_grading_basis: null,
        ai_reference_answers: null,
        ai_model: null,
      },
      now: '2026-07-14T23:00:00.000Z',
    })).resolves.toEqual({ id: 'response-1', revision: 4, score: null, feedback: null })

    expect(rpc).toHaveBeenCalledWith('save_test_response_grades_with_provenance_atomic', expect.objectContaining({
      p_student_id: null,
      p_grade_rows: [expect.objectContaining({ response_id: 'response-1' })],
    }))
  })

  it('accepts only server-signed manual AI provenance', async () => {
    const aiGrade = {
      expected_response_revision: 3,
      score: 3.5,
      feedback: 'Teacher-edited feedback',
      clear_grade: false,
      ai_grading_basis: 'teacher_key' as const,
      ai_reference_answers: null,
      ai_model: 'gpt-5-nano',
      question_grading_snapshot: questionGradingSnapshot,
      ai_provenance_token: createManualTestAiProvenanceToken({
        teacherId: 'teacher-1',
        testId: 'test-1',
        responseId: 'response-1',
        responseRevision: 3,
        gradingBasis: 'teacher_key',
        referenceAnswers: null,
        model: 'gpt-5-nano',
        suggestedScore: 4,
        suggestedFeedback: 'Original AI feedback',
        questionGradingSnapshot,
        gradingProvenance,
      }),
      ai_suggested_score: 4,
      ai_suggested_feedback: 'Original AI feedback',
      ai_grading_provenance: gradingProvenance,
    }
    rpc.mockResolvedValueOnce({
      data: {
        saved_count: 1,
        cleared_count: 0,
        responses: [{ id: 'response-1', revision: 4, score: 3.5, feedback: 'Teacher-edited feedback' }],
      },
      error: null,
    })

    await expect(saveTestResponseGrade({
      teacherId: 'teacher-1',
      testId: 'test-1',
      responseId: 'response-1',
      grade: aiGrade,
    })).resolves.toEqual(expect.objectContaining({ revision: 4 }))

    expect(rpc).toHaveBeenCalledWith('save_test_response_grades_with_provenance_atomic', expect.objectContaining({
      p_grade_rows: [expect.objectContaining({
        score: 3.5,
        feedback: 'Teacher-edited feedback',
        ai_suggested_score: 4,
        ai_suggested_feedback: 'Original AI feedback',
        ai_grading_provenance: gradingProvenance,
      })],
    }))

    for (const forgedGrade of [
      { ...aiGrade, ai_model: 'forged-model' },
      { ...aiGrade, ai_suggested_score: 3 },
      { ...aiGrade, ai_suggested_feedback: 'Forged original feedback' },
      {
        ...aiGrade,
        ai_grading_provenance: { ...gradingProvenance, providerRequestCount: 2 },
      },
    ]) {
      await expect(saveTestResponseGrade({
        teacherId: 'teacher-1',
        testId: 'test-1',
        responseId: 'response-1',
        grade: forgedGrade,
      })).rejects.toMatchObject<ApiError>({
        statusCode: 400,
        message: 'AI grading provenance is invalid or expired',
      })
    }
    expect(rpc).toHaveBeenCalledTimes(1)
  })

  it('clears selected open-response grades atomically', async () => {
    rpc.mockResolvedValueOnce({
      data: { cleared_students: 2, skipped_students: 1, cleared_responses: 3 },
      error: null,
    })

    await expect(clearTestOpenResponseGrades({
      teacherId: 'teacher-1',
      testId: 'test-1',
      studentIds: ['student-1', 'student-2', 'student-3'],
      expectedResponses: [{ response_id: 'response-1', expected_response_revision: 4 }],
      now: '2026-07-14T23:00:00.000Z',
    })).resolves.toEqual({ clearedStudents: 2, skippedStudents: 1, clearedResponses: 3 })

    expect(rpc).toHaveBeenCalledWith('clear_test_open_response_grades_atomic', {
      p_now: '2026-07-14T23:00:00.000Z',
      p_student_ids: ['student-1', 'student-2', 'student-3'],
      p_expected_responses: [{ response_id: 'response-1', expected_response_revision: 4 }],
      p_teacher_id: 'teacher-1',
      p_test_id: 'test-1',
    })
  })

  it.each([
    [{ code: '40001', message: 'Test response grade changed; reload and retry' }, 409],
    [{ code: '42501', message: 'Classroom is archived' }, 403],
    [{ code: 'P0002', message: 'Test response not found' }, 404],
    [{ code: '22023', message: 'score cannot exceed 3' }, 400],
    [{ code: '22P02', message: 'invalid input syntax for type uuid' }, 400],
  ])('maps database contract error %# to an API error', async (error, status) => {
    rpc.mockResolvedValueOnce({ data: null, error })

    await expect(saveStudentTestGrades({
      teacherId: 'teacher-1',
      testId: 'test-1',
      studentId: 'student-1',
      grades: [grade],
    })).rejects.toMatchObject<ApiError>({ statusCode: status, message: error.message })
  })

  it('fails closed on an invalid RPC result', async () => {
    rpc.mockResolvedValueOnce({ data: { saved_count: 'one', responses: [] }, error: null })

    await expect(saveStudentTestGrades({
      teacherId: 'teacher-1',
      testId: 'test-1',
      studentId: 'student-1',
      grades: [grade],
    })).rejects.toMatchObject<ApiError>({ statusCode: 500 })
  })

  it('atomically finalizes an AI grade and its run item with the lease token', async () => {
    rpc.mockResolvedValueOnce({
      data: {
        outcome: 'saved',
        response: { id: 'response-1', revision: 3, score: 4, feedback: 'Good work' },
      },
      error: null,
    })

    await expect(finalizeTestAiGradingItem({
      itemId: 'item-1',
      teacherId: 'teacher-1',
      leaseToken: 'lease-1',
      score: 4,
      feedback: 'Good work',
      aiGradingBasis: 'teacher_key',
      aiReferenceAnswers: null,
      aiModel: 'gpt-5-nano',
      aiGradingProvenance: gradingProvenance,
      attemptCount: 1,
      now: '2026-07-14T23:00:00.000Z',
    })).resolves.toEqual(expect.objectContaining({ outcome: 'saved' }))

    expect(rpc).toHaveBeenCalledWith('finalize_test_ai_grading_item_with_provenance_atomic', {
      p_ai_grading_basis: 'teacher_key',
      p_ai_grading_provenance: gradingProvenance,
      p_ai_model: 'gpt-5-nano',
      p_ai_reference_answers: null,
      p_attempt_count: 1,
      p_feedback: 'Good work',
      p_item_id: 'item-1',
      p_lease_token: 'lease-1',
      p_now: '2026-07-14T23:00:00.000Z',
      p_score: 4,
      p_teacher_id: 'teacher-1',
    })
  })

  it('returns a durable stale outcome without a response', async () => {
    rpc.mockResolvedValueOnce({ data: { outcome: 'stale', response: null }, error: null })
    await expect(finalizeTestAiGradingItem({
      itemId: 'item-1', teacherId: 'teacher-1', leaseToken: 'lease-1', score: 4,
      feedback: 'Good work', aiGradingBasis: 'teacher_key', aiReferenceAnswers: null,
      aiModel: 'gpt-5-nano', aiGradingProvenance: gradingProvenance, attemptCount: 1,
    })).resolves.toEqual({ outcome: 'stale', response: null })
  })

  it('fences item state changes with the active lease token', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null })
    await expect(setTestAiGradingItemState({
      itemId: 'item-1',
      leaseToken: 'lease-1',
      status: 'processing',
      attemptCount: 1,
      nextRetryAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      startedAt: '2026-07-14T23:00:00.000Z',
      completedAt: null,
      questionGradingSnapshot: { question_text: 'Explain', points: 5 },
    })).resolves.toBeUndefined()
  })

  it('surfaces a changed lease as a dedicated worker-stop error', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '40001', message: 'Test AI grading lease changed; stop this worker' },
    })
    await expect(setTestAiGradingItemState({
      itemId: 'item-1', leaseToken: 'old-lease', status: 'processing', attemptCount: 1,
      nextRetryAt: null, lastErrorCode: null, lastErrorMessage: null,
      startedAt: null, completedAt: null, questionGradingSnapshot: { question_text: 'Explain', points: 5 },
    })).rejects.toBeInstanceOf(TestAiGradingLeaseLostError)
  })

  it('renews the active lease and rejects a lost lease', async () => {
    rpc.mockResolvedValueOnce({ data: true, error: null })
    await expect(renewTestAiGradingRunLease({
      runId: 'run-1', leaseToken: 'lease-1', leaseSeconds: 60,
    })).resolves.toBeUndefined()

    rpc.mockResolvedValueOnce({ data: null, error: { code: '40001', message: 'Lease changed' } })
    await expect(renewTestAiGradingRunLease({
      runId: 'run-1', leaseToken: 'lease-1', leaseSeconds: 60,
    })).rejects.toBeInstanceOf(TestAiGradingLeaseLostError)
  })
})
