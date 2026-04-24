import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockSupabaseClient,
  prepareTestOpenResponseGradingContext,
  resolveReusableTestOpenResponseReferenceAnswers,
  suggestTestOpenResponseGradeWithContext,
  suggestTestOpenResponseGradesBatchWithContext,
} = vi.hoisted(() => ({
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

vi.mock('@/lib/ai-test-grading', () => ({
  getTestOpenResponseGradingModel: vi.fn(() => 'gpt-5-nano'),
  isRetryableTestAiGradingError: vi.fn(() => false),
  prepareTestOpenResponseGradingContext,
  resolveReusableTestOpenResponseReferenceAnswers,
  suggestTestOpenResponseGradeWithContext,
  suggestTestOpenResponseGradesBatchWithContext,
}))

import { tickTestAiGradingRun } from '@/lib/server/test-ai-grading-runs'

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
  responseRows: Array<{ id: string; response_text: string | null }>
  responseUpdateErrors?: Record<string, { message: string }>
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
    question_text: 'Explain the runtime.',
    points: 5,
    response_monospace: false,
    answer_key: 'Use a hash map.',
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
      },
    ]),
  )

  mockSupabaseClient.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'claim_test_ai_grading_run') {
      return { data: true, error: null }
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
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((field: string, value: string) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                if (field === 'id' && value === run.id) {
                  Object.assign(run, payload)
                  return { data: { ...run }, error: null }
                }
                return { data: null, error: null }
              }),
            })),
          })),
        })),
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
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn(async (field: string, value: string) => {
            const item = items.find((candidate) => field === 'id' && candidate.id === value)
            if (item) Object.assign(item, payload)
            return { error: null }
          }),
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
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((field: string, value: string) => ({
            eq: vi.fn(async (innerField: string, innerValue: string) => {
              if (field === 'id' && innerField === 'test_id' && innerValue === 'test-1') {
                const error = opts.responseUpdateErrors?.[value] ?? null
                if (error) {
                  return { error }
                }
                const row = responses.get(value)
                if (row) Object.assign(row, payload)
                return { error: null }
              }

              throw new Error(`Unexpected test_responses update chain: ${field}/${innerField}`)
            }),
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
      },
      {
        responseId: 'response-2',
        score: 3,
        feedback: 'Partial.',
        model: 'gpt-5-nano',
        grading_basis: 'teacher_key',
        reference_answers: ['Use a hash map.'],
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
      }),
    )
    expect(suggestTestOpenResponseGradesBatchWithContext).toHaveBeenCalledTimes(1)
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
})
