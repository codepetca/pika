import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockLoadClassroomAiSanitizationContext,
  mockSupabaseClient,
  prepareTestOpenResponseGradingContext,
  resolveReusableTestOpenResponseReferenceAnswers,
  suggestTestOpenResponseGradeWithContext,
  suggestTestOpenResponseGradesBatchWithContext,
} = vi.hoisted(() => ({
  mockLoadClassroomAiSanitizationContext: vi.fn(),
  mockSupabaseClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
  prepareTestOpenResponseGradingContext: vi.fn(),
  resolveReusableTestOpenResponseReferenceAnswers: vi.fn(),
  suggestTestOpenResponseGradeWithContext: vi.fn(),
  suggestTestOpenResponseGradesBatchWithContext: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/server/tests', () => ({
  isMissingTestAttemptReturnColumnsError: vi.fn(() => false),
  isMissingTestResponseAiColumnsError: vi.fn(() => false),
}))

vi.mock('@/lib/server/ai-sanitization', () => ({
  loadClassroomAiSanitizationContext: mockLoadClassroomAiSanitizationContext,
}))

vi.mock('@/lib/ai-test-grading', () => ({
  getTestOpenResponseGradingModel: vi.fn(() => 'gpt-5-nano'),
  isRetryableTestAiGradingError: vi.fn(() => false),
  prepareTestOpenResponseGradingContext,
  resolveReusableTestOpenResponseReferenceAnswers,
  suggestTestOpenResponseGradeWithContext,
  suggestTestOpenResponseGradesBatchWithContext,
}))

import { tickTestAiGradingRun } from '@/lib/server/test-ai-grading-runs'

const gradingProvenance = {
  schemaVersion: 'test-grading-provenance-v1' as const,
  gradingRequestId: '10000000-0000-4000-8000-000000000001',
  provider: 'openai',
  model: 'gpt-5-nano',
  policyVersion: 'pika-test-open-response-policy-v1',
  promptVersion: 'pika-test-open-response-bulk-prompt-v1',
  gradingProfileVersion: 'pika-test-open-response-v1',
  rubricVersion: 'pika-test-open-response-rubric-v1',
  operation: 'batch' as const,
  batchSize: 2,
  providerRequestCount: 1,
  tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
}

function buildPreparedContext() {
  return {
    model: 'gpt-5-nano',
    maxPoints: 5,
    grading_basis: 'teacher_key' as const,
    reference_answers: ['Use a hash map.'],
    reference_answers_source: 'teacher_key' as const,
    answerKey: 'Use a hash map.',
    sampleSolution: null,
    scoreBuckets: null,
    promptProfile: 'bulk' as const,
    isCodingQuestion: false,
    sampleSolutionIncluded: false,
    promptMetrics: {
      systemChars: 0,
      userChars: 0,
      promptChars: 0,
      estimatedInputTokens: 0,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualTotalTokens: null,
    },
    systemPrompt: 'system',
    userPromptPrefix: 'user',
  }
}

function buildRunItem(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: overrides?.id ?? 'item-1',
    run_id: 'run-1',
    test_id: 'test-1',
    student_id: overrides?.student_id ?? 'student-1',
    question_id: 'question-1',
    response_id: overrides?.response_id ?? 'response-1',
    response_revision: overrides?.response_revision ?? 1,
    question_grading_snapshot: overrides?.question_grading_snapshot ?? null,
    queue_position: overrides?.queue_position ?? 0,
    status: 'queued',
    attempt_count: 0,
    next_retry_at: null,
    last_error_code: null,
    last_error_message: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-04-23T00:00:00.000Z',
    updated_at: '2026-04-23T00:00:00.000Z',
    ...overrides,
  }
}

function buildTickHarness(opts: {
  responseRows: Array<{
    id: string
    response_text: string | null
    revision?: number
    score?: number | null
    feedback?: string | null
  }>
  responseUpdateErrors?: Record<string, { code?: string; message: string }>
  loseLeaseOnFinalize?: boolean
  changeQuestionBeforeFinalize?: boolean
  questionAnswerKey?: string
}) {
  const run = {
    id: 'run-1',
    test_id: 'test-1',
    status: 'queued',
    triggered_by: 'teacher-1',
    model: 'gpt-5-nano',
    prompt_guideline_override: null,
    requested_student_ids_json: ['student-1', 'student-2'],
    selection_hash: 'selection-hash',
    requested_count: 2,
    eligible_student_count: 2,
    queued_response_count: 2,
    processed_count: 0,
    completed_count: 0,
    skipped_unanswered_count: 0,
    skipped_already_graded_count: 0,
    failed_count: 0,
    error_samples_json: [],
    lease_token: null,
    lease_expires_at: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-04-23T00:00:00.000Z',
    updated_at: '2026-04-23T00:00:00.000Z',
  }

  const items = [
    buildRunItem({
      id: 'item-1',
      student_id: 'student-1',
      response_id: 'response-1',
      queue_position: 0,
    }),
    buildRunItem({
      id: 'item-2',
      student_id: 'student-2',
      response_id: 'response-2',
      queue_position: 1,
    }),
  ]

  const question = {
    id: 'question-1',
    updated_at: '2026-04-23T00:00:00.000Z',
    question_text: 'Explain the runtime.',
    points: 5,
    response_monospace: false,
    answer_key: opts.questionAnswerKey ?? 'Use a hash map.',
    sample_solution: null,
    ai_reference_cache_key: 'cache-key',
    ai_reference_cache_answers: ['Use a hash map.'],
    ai_reference_cache_model: 'gpt-5-nano',
  }

  const responses = new Map(
    opts.responseRows.map((row) => [
      row.id,
      {
        ...row,
        revision: row.revision ?? 1,
        score: row.score ?? null,
        feedback: row.feedback ?? null,
      },
    ]),
  )

  mockSupabaseClient.rpc.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'claim_test_ai_grading_run') {
      run.status = 'running'
      run.lease_token = String(args.p_lease_token)
      run.lease_expires_at = new Date(Date.now() + 120_000).toISOString()
      return { data: [{ ...run }], error: null }
    }

    if (fn === 'renew_test_ai_grading_run_lease') {
      if (args.p_lease_token !== run.lease_token) {
        return { data: null, error: { code: '40001', message: 'Lease changed' } }
      }
      run.lease_expires_at = new Date(Date.now() + 60_000).toISOString()
      return { data: true, error: null }
    }

    if (fn === 'set_test_ai_grading_item_state_atomic') {
      if (args.p_lease_token !== run.lease_token) {
        return { data: null, error: { code: '40001', message: 'Lease changed' } }
      }
      const item = items.find((candidate) => candidate.id === args.p_item_id)
      if (!item) return { data: null, error: { code: 'P0002', message: 'Item missing' } }
      Object.assign(item, {
        status: args.p_status,
        attempt_count: args.p_attempt_count,
        next_retry_at: args.p_next_retry_at,
        last_error_code: args.p_last_error_code,
        last_error_message: args.p_last_error_message,
        started_at: args.p_started_at,
        completed_at: args.p_completed_at,
        ...(args.p_status === 'processing' && item.question_grading_snapshot == null
          ? { question_grading_snapshot: args.p_question_grading_snapshot }
          : {}),
      })
      return { data: true, error: null }
    }

    if (fn === 'finalize_test_ai_grading_item_with_provenance_atomic') {
      if (opts.loseLeaseOnFinalize) {
        run.lease_token = 'replacement-lease'
        return { data: null, error: { code: '40001', message: 'Lease changed' } }
      }
      if (args.p_lease_token !== run.lease_token) {
        return { data: null, error: { code: '40001', message: 'Lease changed' } }
      }
      const item = items.find((candidate) => candidate.id === args.p_item_id)
      if (!item) return { data: null, error: { code: 'P0002', message: 'Item missing' } }
      const response = responses.get(String(item.response_id))
      const forcedError = opts.responseUpdateErrors?.[String(item.response_id)]
      if (forcedError) return { data: null, error: forcedError }
      if (item.status === 'completed' && response) {
        return { data: { outcome: 'replayed', response: { ...response } }, error: null }
      }
      if (!response || response.revision !== item.response_revision) {
        Object.assign(item, {
          status: 'failed',
          attempt_count: args.p_attempt_count,
          last_error_code: 'source_revision_conflict',
          last_error_message: 'Response changed after this item was queued',
          completed_at: args.p_now,
        })
        return { data: { outcome: 'stale', response: null }, error: null }
      }
      if (opts.changeQuestionBeforeFinalize) question.answer_key = 'Changed answer key'
      const currentQuestionSnapshot = {
        test_title: 'Test One',
        question_text: question.question_text,
        points: question.points,
        response_monospace: question.response_monospace,
        answer_key: question.answer_key,
        sample_solution: question.sample_solution,
      }
      if (JSON.stringify(item.question_grading_snapshot) !== JSON.stringify(currentQuestionSnapshot)) {
        Object.assign(item, {
          status: 'failed',
          attempt_count: args.p_attempt_count,
          last_error_code: 'question_revision_conflict',
          last_error_message: 'Question changed after AI grading started',
          completed_at: args.p_now,
        })
        return { data: { outcome: 'stale', response: null }, error: null }
      }
      Object.assign(response, {
        score: args.p_score,
        feedback: args.p_feedback,
        ai_grading_basis: args.p_ai_grading_basis,
        ai_reference_answers: args.p_ai_reference_answers,
        ai_model: args.p_ai_model,
        ai_suggested_score: args.p_score,
        ai_suggested_feedback: args.p_feedback,
        ai_grading_provenance: args.p_ai_grading_provenance,
        revision: response.revision + 1,
      })
      Object.assign(item, {
        status: 'completed',
        attempt_count: args.p_attempt_count,
        next_retry_at: null,
        last_error_code: null,
        last_error_message: null,
        completed_at: args.p_now,
      })
      return { data: { outcome: 'saved', response: { ...response } }, error: null }
    }
    throw new Error(`Unexpected rpc: ${fn}`)
  })

  ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
    if (table === 'test_ai_grading_runs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((field: string, value: string) => ({
            maybeSingle: vi.fn(async () => ({
              data: field === 'id' && value === run.id ? { ...run } : null,
              error: null,
            })),
          })),
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          const filters = new Map<string, unknown>()
          const mutation = {
            eq: vi.fn((field: string, value: unknown) => {
              filters.set(field, value)
              return mutation
            }),
            gt: vi.fn((field: string, value: unknown) => {
              filters.set(`${field}:gt`, value)
              return mutation
            }),
            select: vi.fn(() => mutation),
            maybeSingle: vi.fn(async () => {
              if (filters.get('id') !== run.id || filters.get('lease_token') !== run.lease_token) {
                return { data: null, error: null }
              }
              const leaseThreshold = filters.get('lease_expires_at:gt')
              if (
                typeof leaseThreshold === 'string'
                && (!run.lease_expires_at || run.lease_expires_at <= leaseThreshold)
              ) {
                return { data: null, error: null }
              }
              Object.assign(run, payload)
              return { data: { ...run }, error: null }
            }),
          }
          return mutation
        }),
      }
    }

    if (table === 'test_ai_grading_run_items') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((field: string, value: string) => ({
            order: vi.fn(async () => ({
              data:
                field === 'run_id' && value === run.id
                  ? items.map((item) => ({ ...item }))
                  : [],
              error: null,
            })),
          })),
        })),
      }
    }

    if (table === 'tests') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                id: 'test-1',
                title: 'Test One',
                classroom_id: 'classroom-1',
              },
              error: null,
            })),
          })),
        })),
      }
    }

    if (table === 'test_questions') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((field: string, value: string) => ({
            eq: vi.fn(async (innerField: string, innerValue: string) => ({
              data:
                field === 'test_id' &&
                value === 'test-1' &&
                innerField === 'question_type' &&
                innerValue === 'open_response'
                  ? [{ ...question }]
                  : [],
              error: null,
            })),
          })),
        })),
      }
    }

    if (table === 'test_responses') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((field: string, value: string) => ({
            in: vi.fn(async (innerField: string, responseIds: string[]) => ({
              data:
                field === 'test_id' && value === 'test-1' && innerField === 'id'
                  ? responseIds.map((responseId) => responses.get(responseId)).filter(Boolean)
                  : [],
              error: null,
            })),
          })),
        })),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  return { items, responses, run }
}

describe('tickTestAiGradingRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from.mockReset()
    mockSupabaseClient.rpc.mockReset()
    mockLoadClassroomAiSanitizationContext.mockResolvedValue({
      students: [],
      initialsMap: {},
    })
    resolveReusableTestOpenResponseReferenceAnswers.mockReturnValue({
      expectedCacheKey: 'cache-key',
      cacheHit: true,
      referenceAnswers: ['Use a hash map.'],
    })
    prepareTestOpenResponseGradingContext.mockResolvedValue(buildPreparedContext())
  })

  it('keeps already-completed items completed when a later sibling save fails', async () => {
    const { items, responses } = buildTickHarness({
      responseRows: [
        { id: 'response-1', response_text: 'Answer one' },
        { id: 'response-2', response_text: 'Answer two' },
      ],
      responseUpdateErrors: {
        'response-2': { message: 'Failed to save AI grade' },
      },
    })

    suggestTestOpenResponseGradesBatchWithContext.mockResolvedValue([
      {
        responseId: 'response-1',
        score: 5,
        feedback: 'Correct.',
        model: 'gpt-5-nano',
        grading_basis: 'teacher_key',
        reference_answers: ['Use a hash map.'],
        provenance: gradingProvenance,
      },
      {
        responseId: 'response-2',
        score: 3,
        feedback: 'Partial.',
        model: 'gpt-5-nano',
        grading_basis: 'teacher_key',
        reference_answers: ['Use a hash map.'],
        provenance: gradingProvenance,
      },
    ])

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.claimed).toBe(true)
    expect(result.run.status).toBe('completed_with_errors')
    expect(result.run.completed_count).toBe(1)
    expect(result.run.failed_count).toBe(1)
    expect(items[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
        attempt_count: 1,
        last_error_code: null,
        last_error_message: null,
      }),
    )
    expect(items[1]).toEqual(
      expect.objectContaining({
        status: 'failed',
        attempt_count: 1,
        last_error_code: 'internal',
        last_error_message: 'Failed to save AI grade',
      }),
    )
    expect(responses.get('response-1')).toEqual(
      expect.objectContaining({
        score: 5,
        feedback: 'Correct.',
        ai_grading_provenance: gradingProvenance,
      }),
    )
    expect(suggestTestOpenResponseGradesBatchWithContext).toHaveBeenCalledTimes(1)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'renew_test_ai_grading_run_lease',
      expect.objectContaining({
        p_run_id: 'run-1',
        p_lease_token: expect.any(String),
        p_lease_seconds: 120,
      }),
    )
  })

  it('fails a single active item cleanly when finalization fails', async () => {
    const { items, run } = buildTickHarness({
      responseRows: [{ id: 'response-1', response_text: 'Answer one' }],
      responseUpdateErrors: {
        'response-1': { message: 'Failed to finalize AI grade' },
      },
    })

    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 5,
      feedback: 'Correct.',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: ['Use a hash map.'],
      provenance: gradingProvenance,
    })

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.claimed).toBe(true)
    expect(result.run.status).toBe('completed_with_errors')
    expect(run.status).toBe('completed_with_errors')
    expect(items[0]).toEqual(expect.objectContaining({
      status: 'failed',
      attempt_count: 1,
      last_error_code: 'internal',
      last_error_message: 'Failed to finalize AI grade',
    }))
    expect(items[0].status).not.toBe('processing')
    expect(suggestTestOpenResponseGradeWithContext).toHaveBeenCalledTimes(1)
  })

  it('retries only the response omitted from a batch suggestion', async () => {
    const { items, responses } = buildTickHarness({
      responseRows: [
        { id: 'response-1', response_text: 'Answer one' },
        { id: 'response-2', response_text: 'Answer two' },
      ],
    })

    suggestTestOpenResponseGradesBatchWithContext.mockResolvedValue([
      {
        responseId: 'response-1',
        score: 5,
        feedback: 'Correct.',
        model: 'gpt-5-nano',
        grading_basis: 'teacher_key',
        reference_answers: ['Use a hash map.'],
        provenance: gradingProvenance,
      },
    ])

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.claimed).toBe(true)
    expect(result.run.status).toBe('running')
    expect(result.run.completed_count).toBe(1)
    expect(result.run.failed_count).toBe(0)
    expect(items[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
        attempt_count: 1,
      }),
    )
    expect(items[1]).toEqual(
      expect.objectContaining({
        status: 'queued',
        attempt_count: 1,
        last_error_code: 'invalid_output',
        last_error_message: 'AI grading service failed for this response. Try again.',
      }),
    )
    expect(items[1].next_retry_at).toEqual(expect.any(String))
    expect(items[1].question_grading_snapshot).toEqual(expect.objectContaining({
      test_title: 'Test One',
      question_text: 'Explain the runtime.',
    }))
    expect(responses.get('response-1')).toEqual(
      expect.objectContaining({
        score: 5,
        feedback: 'Correct.',
      }),
    )
  })

  it('fails only the omitted response after retries are exhausted without exposing the response id', async () => {
    const { items, responses } = buildTickHarness({
      responseRows: [
        { id: 'response-1', response_text: 'Answer one' },
        { id: 'response-2', response_text: 'Answer two' },
      ],
    })
    items[1].attempt_count = 2

    suggestTestOpenResponseGradesBatchWithContext.mockResolvedValue([
      {
        responseId: 'response-1',
        score: 5,
        feedback: 'Correct.',
        model: 'gpt-5-nano',
        grading_basis: 'teacher_key',
        reference_answers: ['Use a hash map.'],
        provenance: gradingProvenance,
      },
    ])

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.claimed).toBe(true)
    expect(result.run.status).toBe('completed_with_errors')
    expect(result.run.completed_count).toBe(1)
    expect(result.run.failed_count).toBe(1)
    expect(items[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
        attempt_count: 1,
      }),
    )
    expect(items[1]).toEqual(
      expect.objectContaining({
        status: 'failed',
        attempt_count: 3,
        last_error_code: 'invalid_output',
        last_error_message: 'AI grading service failed for this response. Try again.',
      }),
    )
    expect(result.run.error_samples).toEqual([
      expect.objectContaining({
        student_id: 'student-2',
        code: 'invalid_output',
        message: 'AI grading service failed for this response. Try again.',
      }),
    ])
    expect(result.run.error_samples[0]?.message).not.toContain('response-2')
    expect(items[1].question_grading_snapshot).toEqual(expect.objectContaining({
      test_title: 'Test One',
      question_text: 'Explain the runtime.',
    }))
    expect(responses.get('response-1')).toEqual(
      expect.objectContaining({
        score: 5,
        feedback: 'Correct.',
      }),
    )
  })

  it('fails only the missing response item and still grades available siblings', async () => {
    const { items, responses } = buildTickHarness({
      responseRows: [{ id: 'response-1', response_text: 'Answer one' }],
    })

    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 4,
      feedback: 'Mostly correct.',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: ['Use a hash map.'],
      provenance: gradingProvenance,
    })

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.claimed).toBe(true)
    expect(result.run.status).toBe('completed_with_errors')
    expect(result.run.completed_count).toBe(1)
    expect(result.run.failed_count).toBe(1)
    expect(items[0]).toEqual(
      expect.objectContaining({
        status: 'completed',
        attempt_count: 1,
      }),
    )
    expect(items[1]).toEqual(
      expect.objectContaining({
        status: 'failed',
        attempt_count: 1,
        last_error_message: 'Response is no longer available for grading',
      }),
    )
    expect(responses.get('response-1')).toEqual(
      expect.objectContaining({
        score: 4,
        feedback: 'Mostly correct.',
      }),
    )
    expect(suggestTestOpenResponseGradeWithContext).toHaveBeenCalledTimes(1)
    expect(suggestTestOpenResponseGradesBatchWithContext).not.toHaveBeenCalled()
  })

  it('marks an item stale without overwriting a response changed after queueing', async () => {
    const { items, responses } = buildTickHarness({
      responseRows: [
        {
          id: 'response-1',
          response_text: 'Answer one',
          revision: 2,
          score: 2,
          feedback: 'Teacher edit',
        },
      ],
    })

    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 5,
      feedback: 'AI result',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: ['Use a hash map.'],
      provenance: gradingProvenance,
    })

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.run.status).toBe('completed_with_errors')
    expect(items[0]).toEqual(
      expect.objectContaining({
        status: 'failed',
        last_error_code: 'source_revision_conflict',
      }),
    )
    expect(responses.get('response-1')).toEqual(
      expect.objectContaining({ revision: 2, score: 2, feedback: 'Teacher edit' }),
    )
  })

  it('stops cleanly when a newer worker replaces its lease', async () => {
    const { items, run } = buildTickHarness({
      responseRows: [{ id: 'response-1', response_text: 'Answer one' }],
      loseLeaseOnFinalize: true,
    })

    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 5,
      feedback: 'Correct.',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: ['Use a hash map.'],
      provenance: gradingProvenance,
    })

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.claimed).toBe(false)
    expect(run.status).toBe('running')
    expect(run.lease_token).toBe('replacement-lease')
    expect(items[0].status).toBe('processing')
  })

  it('does not save a suggestion after the answer key changes', async () => {
    const { items, responses } = buildTickHarness({
      responseRows: [{ id: 'response-1', response_text: 'Answer one' }],
      changeQuestionBeforeFinalize: true,
    })
    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 5,
      feedback: 'Correct.',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: ['Use a hash map.'],
      provenance: gradingProvenance,
    })

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.run.status).toBe('completed_with_errors')
    expect(items[0]).toEqual(expect.objectContaining({
      status: 'failed',
      last_error_code: 'question_revision_conflict',
    }))
    expect(responses.get('response-1')).toEqual(expect.objectContaining({ score: null }))
  })

  it('preserves the first question snapshot when retrying after a question change', async () => {
    const { items, responses } = buildTickHarness({
      responseRows: [{ id: 'response-1', response_text: 'Answer one' }],
      questionAnswerKey: 'Changed answer key',
    })
    items[0].attempt_count = 1
    items[0].question_grading_snapshot = {
      test_title: 'Test One',
      question_text: 'Explain the runtime.',
      points: 5,
      response_monospace: false,
      answer_key: 'Use a hash map.',
      sample_solution: null,
    }
    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 5,
      feedback: 'Correct.',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: ['Use a hash map.'],
      provenance: gradingProvenance,
    })

    const result = await tickTestAiGradingRun({ testId: 'test-1', runId: 'run-1' })

    expect(result.run.status).toBe('completed_with_errors')
    expect(items[0]).toEqual(expect.objectContaining({
      status: 'failed',
      attempt_count: 2,
      last_error_code: 'question_revision_conflict',
      question_grading_snapshot: expect.objectContaining({ answer_key: 'Use a hash map.' }),
    }))
    expect(responses.get('response-1')).toEqual(expect.objectContaining({ score: null }))
  })
})
