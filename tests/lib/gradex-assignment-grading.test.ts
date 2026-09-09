import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { withRedirectCanary } from '../helpers/redirect-canary'

const {
  mockBuildPikaAssignmentGradexRunPayload,
  mockLoadAssignmentSubmissionArtifactsForDocs,
  mockLoadClassroomAiSanitizationContext,
  mockMapGradexItemsToPikaGradeRecords,
} = vi.hoisted(() => ({
  mockBuildPikaAssignmentGradexRunPayload: vi.fn(),
  mockLoadAssignmentSubmissionArtifactsForDocs: vi.fn(),
  mockLoadClassroomAiSanitizationContext: vi.fn(),
  mockMapGradexItemsToPikaGradeRecords: vi.fn(),
}))

vi.mock('@/lib/server/assignment-submission-artifacts', () => ({
  loadAssignmentSubmissionArtifactsForDocs: mockLoadAssignmentSubmissionArtifactsForDocs,
}))

vi.mock('@/lib/server/ai-sanitization', () => ({
  loadClassroomAiSanitizationContext: mockLoadClassroomAiSanitizationContext,
}))

vi.mock('@/lib/server/gradex-assignment-payload', () => ({
  buildPikaAssignmentGradexRunPayload: mockBuildPikaAssignmentGradexRunPayload,
  getRequiredPseudonymSalt: () => 'test-pseudonym-salt',
  pseudonymizePikaGradexRef: (prefix: string, value: string) => `pika-${prefix}-${value}`,
}))

vi.mock('@/lib/server/gradex-smoke-runner', () => ({
  mapGradexItemsToPikaGradeRecords: mockMapGradexItemsToPikaGradeRecords,
}))

import {
  GRADEX_ASSIGNMENT_RUN_MODEL,
  isGradexAssignmentGradingEnabled,
  submitOrPollGradexAssignmentRun,
} from '@/lib/server/gradex-assignment-grading'

describe('Gradex assignment grading processor', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = 'true'
    process.env.GRADEX_API_URL = 'https://gradex.example.test/'
    process.env.GRADEX_API_KEY = 'gx_test_key'
    mockLoadAssignmentSubmissionArtifactsForDocs.mockResolvedValue([])
    mockLoadClassroomAiSanitizationContext.mockResolvedValue({ students: [], initialsMap: {} })
    mockBuildPikaAssignmentGradexRunPayload.mockReturnValue({
      gradexRequest: {
        assignment: {
          external_assignment_id: 'pika-assignment-safe',
          title: 'Safe Assignment',
          instructions: 'Safe instructions',
          type: 'essay',
          metadata: { adapter_version: 'pika-assignment-adapter-v1', client: 'pika' },
        },
        rubric: { version: 'pika-essay-ctw-v1', criteria: [] },
        settings: {
          grading_profile: 'pika-assignment-v1',
          model_profile: 'calibration',
          provider: 'auto',
          tier: 'auto',
          prompt_version: 'gradex-essay-rubric-v1',
          feedback_style: 'balanced',
          confidence_threshold: 0.65,
          request_timeout_ms: 25_000,
        },
        submissions: [],
        workflow_evidence_by_submission_id: {},
      },
      mappings: [
        {
          assignment_doc_id: 'doc-1',
          student_id: 'student-1',
          pika_grade_record_ref: 'pika-grade-safe',
          pika_submission_ref: 'pika-submission-safe',
          pika_student_ref: 'pika-student-safe',
          gradex_submission_id: 'pika-submission-safe',
          gradex_student_id: 'pika-student-safe',
        },
      ],
    })
  })

  it('uses an explicit feature flag for Gradex assignment grading', () => {
    expect(isGradexAssignmentGradingEnabled()).toBe(true)
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = 'false'
    expect(isGradexAssignmentGradingEnabled()).toBe(false)
  })

  it.each([307, 308])('rejects HTTP %i without forwarding a submission, preserving retry state', async (status) => {
    await withRedirectCanary(status, 'https://gradex.example.test/api/v1/grading-runs', async (canary) => {
      vi.stubGlobal('fetch', canary.fetchImpl)
      const supabase = buildSupabase()
      await submitOrPollGradexAssignmentRun({
        supabase: supabase.client, assignment: assignment(), run: run(), items: [item()],
      })
      expect(canary.sourceRequests()).toBe(1)
      expect(canary.targetRequests()).toBe(0)
      expect(supabase.itemUpdates.at(-1)?.payload).toMatchObject({
        status: 'queued', last_error_code: 'gradex_network_error', attempt_count: 1,
        last_error_message: 'Gradex request failed before a response was received',
      })
    })
  })

  it.each([
    'http://gradex.example.test', 'http://localhost:3001', 'ftp://gradex.example.test',
    'https://private-key@gradex.example.test', 'https://gradex.example.test?key=private',
    'https://gradex.example.test#private', 'https://gradex.example.test/api',
    'https://gradex.example.test?', 'https://gradex.example.test#', 'not a URL',
  ])('rejects unsafe production configuration before loading work or sending: %s', async (url) => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('GRADEX_API_URL', url)
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)
    await expect(submitOrPollGradexAssignmentRun({
      supabase: buildSupabase().client, assignment: assignment(), run: run(), items: [item()],
    })).rejects.toThrow('Gradex API URL must be an HTTPS origin')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(mockBuildPikaAssignmentGradexRunPayload).not.toHaveBeenCalled()
  })

  it.each(['localhost', '127.0.0.1', '[::1]'])('permits development loopback HTTP on %s', async (host) => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('GRADEX_API_URL', `http://${host}:3001/`)
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    vi.stubGlobal('fetch', fetchImpl)
    await submitOrPollGradexAssignmentRun({
      supabase: buildSupabase().client, assignment: assignment(), run: run(), items: [item()],
    })
    expect(fetchImpl).toHaveBeenCalledWith(`http://${host}:3001/api/v1/grading-runs`,
      expect.objectContaining({ redirect: 'error' }))
  })

  it.each(['test', 'production', ''])('rejects loopback HTTP outside explicit development (%s)', async (mode) => {
    vi.stubEnv('NODE_ENV', mode)
    vi.stubEnv('GRADEX_API_URL', 'http://127.0.0.1:3001')
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)
    await expect(submitOrPollGradexAssignmentRun({
      supabase: buildSupabase().client, assignment: assignment(), run: run(), items: [item()],
    })).rejects.toThrow('Gradex API URL must be an HTTPS origin')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects remote HTTP even in development', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('GRADEX_API_URL', 'http://localhost.example.test')
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)
    await expect(submitOrPollGradexAssignmentRun({
      supabase: buildSupabase().client, assignment: assignment(), run: run(), items: [item()],
    })).rejects.toThrow('Gradex API URL must be an HTTPS origin')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('keeps the request timeout active through response-body consumption', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const response = new Response('{}', { status: 202 })
      vi.spyOn(response, 'json').mockImplementation(() => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('PRIVATE', 'AbortError')), { once: true })
      }))
      return response
    }))
    const supabase = buildSupabase()
    const pending = submitOrPollGradexAssignmentRun({
      supabase: supabase.client, assignment: assignment(), run: run(), items: [item()],
    })
    await vi.advanceTimersByTimeAsync(25_001)
    await pending
    expect(supabase.itemUpdates.at(-1)?.payload).toMatchObject({
      status: 'queued', last_error_code: 'gradex_timeout', last_error_message: 'Gradex request timed out',
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([400, 307, 308, 503])('discards private HTTP %i body without reading it', async (status) => {
    const marker = 'PRIVATE synthetic-student-work api-key'
    const response = new Response(JSON.stringify({ error: { message: marker, details: marker } }), { status })
    const read = vi.spyOn(response, 'json')
    const cancel = vi.spyOn(response.body!, 'cancel')
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(response))
    const supabase = buildSupabase()
    const failure = await submitOrPollGradexAssignmentRun({
      supabase: supabase.client, assignment: assignment(), run: run(), items: [item()],
    }).catch((error: Error) => error)
    expect(JSON.stringify(supabase.itemUpdates)).not.toContain(marker)
    if (status === 503) {
      expect(supabase.itemUpdates.at(-1)?.payload.last_error_message).toBe('Gradex request failed with status 503')
    } else {
      expect(failure).toMatchObject({ message: `Gradex request failed with status ${status}` })
    }
    expect(read).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledOnce()
  })

  it.each(['invalid JSON PRIVATE', JSON.stringify({ status: 'PRIVATE unknown enum' })])(
    'does not expose JSON or schema errors from successful HTTP responses', async (body) => {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status: 202 })))
      await expect(submitOrPollGradexAssignmentRun({
        supabase: buildSupabase().client, assignment: assignment(), run: run(), items: [item()],
      })).rejects.toThrow('Gradex returned an invalid response')
    },
  )

  it('submits a sanitized Gradex run and stores remote run metadata', async () => {
    const supabase = buildSupabase()
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://gradex.example.test/api/v1/grading-runs')
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer gx_test_key' })
      expect(JSON.parse(String(init?.body))).toEqual(
        expect.objectContaining({
          assignment: expect.objectContaining({
            metadata: expect.objectContaining({
              client_run_ref: expect.stringMatching(/^pika-run-/),
              idempotency_key: expect.stringMatching(/^pika-run-/),
            }),
          }),
        }),
      )
      return jsonResponse(202, {
        id: 'gradex-run-1',
        status: 'queued',
        counts: { requested: 1, processed: 0, completed: 0, failed: 0, skipped: 0, pending: 1 },
        provider: null,
        model: null,
        tier: null,
        policy_version: null,
        prompt_version: null,
        items: [],
      })
    })
    vi.stubGlobal('fetch', fetchImpl)

    await submitOrPollGradexAssignmentRun({
      supabase: supabase.client,
      assignment: assignment(),
      run: run({ gradex_run_id: null }),
      items: [item()],
    })

    expect(mockBuildPikaAssignmentGradexRunPayload).toHaveBeenCalledWith(
      expect.objectContaining({
        assignment: expect.objectContaining({ id: 'assignment-1' }),
        assignmentDocs: [expect.objectContaining({ id: 'doc-1' })],
        sanitizationContext: { students: [], initialsMap: {} },
      }),
    )
    expect(supabase.itemUpdates).toEqual([
      expect.objectContaining({
        table: 'assignment_ai_grading_run_items',
        id: 'item-1',
        payload: expect.objectContaining({ status: 'processing' }),
      }),
    ])
    expect(supabase.runUpdates).toEqual([
      expect.objectContaining({
        id: 'run-1',
        payload: expect.objectContaining({
          gradex_run_id: 'gradex-run-1',
          gradex_status: 'queued',
          gradex_submitted_at: expect.any(String),
          gradex_last_polled_at: expect.any(String),
        }),
      }),
    ])
  })

  it('rejects a malformed successful submission response before storing metadata', async () => {
    const supabase = buildSupabase()
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () =>
      jsonResponse(202, {
        status: 'queued',
        counts: { requested: 1, processed: 0, completed: 0, failed: 0, skipped: 0, pending: 1 },
        provider: null,
        model: null,
        tier: null,
        policy_version: null,
        prompt_version: null,
      })
    ))

    await expect(submitOrPollGradexAssignmentRun({
      supabase: supabase.client,
      assignment: assignment(),
      run: run({ gradex_run_id: null }),
      items: [item()],
    })).rejects.toThrow()

    expect(supabase.runUpdates).toEqual([])
    expect(supabase.aiGradeCalls).toEqual([])
  })

  it('polls a completed Gradex run and maps results into Pika grade fields', async () => {
    const supabase = buildSupabase()
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      expect(init?.redirect).toBe('error')
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer gx_test_key' })
      if (url === 'https://gradex.example.test/api/v1/grading-runs/gradex-run-1') {
        return jsonResponse(200, {
          id: 'gradex-run-1',
          status: 'completed',
          counts: { requested: 1, processed: 1, completed: 1, failed: 0, skipped: 0, pending: 0 },
          provider: 'openai',
          model: 'gpt-5-nano',
          tier: 'tier_1',
          policy_version: 'gradex-routing-policy-v1',
          prompt_version: 'gradex-essay-rubric-v1',
          items: [{ id: 'gradex-item-1', status: 'completed', external_submission_id: 'pika-submission-safe', external_student_id: 'pika-student-safe', error: null }],
        })
      }
      if (url === 'https://gradex.example.test/api/v1/grading-runs/gradex-run-1/items/gradex-item-1') {
        return jsonResponse(200, {
          id: 'gradex-item-1',
          status: 'completed',
          external_submission_id: 'pika-submission-safe',
          external_student_id: 'pika-student-safe',
          error: null,
          result: {
            provider: 'openai',
            model: 'gpt-5-nano',
            tier: 'tier_1',
            policy_version: 'gradex-routing-policy-v1',
            prompt_version: 'gradex-essay-rubric-v1',
            audit_id: 'audit-1',
            token_usage: null,
          },
        })
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    vi.stubGlobal('fetch', fetchImpl)
    mockMapGradexItemsToPikaGradeRecords.mockReturnValue([
      {
        assignment_doc_id: 'doc-1',
        student_id: 'student-1',
        pika_grade_record_ref: 'pika-grade-safe',
        pika_submission_ref: 'pika-submission-safe',
        gradex_submission_id: 'pika-submission-safe',
        gradex_item_id: 'gradex-item-1',
        status: 'completed',
        score_completion: 8,
        score_thinking: 7,
        score_workflow: 9,
        feedback: 'Strength: clear work. Next step: add one example.',
        provider: 'openai',
        model: 'gpt-5-nano',
        tier: 'tier_1',
        audit_id: 'audit-1',
      },
    ])

    await submitOrPollGradexAssignmentRun({
      supabase: supabase.client,
      assignment: assignment(),
      run: run({ gradex_run_id: 'gradex-run-1' }),
      items: [item({ status: 'processing' })],
    })

    expect(supabase.aiGradeCalls).toEqual([
      expect.objectContaining({
        p_item_id: 'item-1',
        p_teacher_id: 'teacher-1',
        p_score_completion: 8,
        p_score_thinking: 7,
        p_score_workflow: 9,
        p_feedback: 'Strength: clear work. Next step: add one example.',
        p_ai_feedback_model: 'gradex:openai/gpt-5-nano/tier_1',
        p_graded_by: 'teacher-1',
        p_item_status: 'completed',
        p_attempt_count: 1,
      }),
    ])
    expect(supabase.itemUpdates).toEqual([])
  })

  it('queues a retry instead of throwing when a Gradex submission request is retryable', async () => {
    const supabase = buildSupabase()
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(503, {
        error: { message: 'Gradex temporarily unavailable' },
      })
    )
    vi.stubGlobal('fetch', fetchImpl)

    await submitOrPollGradexAssignmentRun({
      supabase: supabase.client,
      assignment: assignment(),
      run: run({ gradex_run_id: null }),
      items: [item()],
    })

    expect(supabase.runUpdates).toEqual([])
    expect(supabase.itemUpdates).toEqual([
      expect.objectContaining({
        id: 'item-1',
        payload: expect.objectContaining({ status: 'processing' }),
      }),
      expect.objectContaining({
        id: 'item-1',
        payload: expect.objectContaining({
          status: 'queued',
          attempt_count: 1,
          last_error_code: 'gradex_retryable_http_error',
          last_error_message: 'Gradex request failed with status 503',
          next_retry_at: expect.any(String),
          completed_at: null,
        }),
      }),
    ])
  })

  it('does not resubmit before a queued Gradex item retry is due', async () => {
    const supabase = buildSupabase()
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)

    await submitOrPollGradexAssignmentRun({
      supabase: supabase.client,
      assignment: assignment(),
      run: run({ gradex_run_id: null }),
      items: [
        item({
          status: 'queued',
          attempt_count: 1,
          next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      ],
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(mockBuildPikaAssignmentGradexRunPayload).not.toHaveBeenCalled()
    expect(supabase.itemUpdates).toEqual([])
    expect(supabase.runUpdates).toEqual([])
  })

  it('queues a retry instead of throwing when a Gradex poll request is retryable', async () => {
    const supabase = buildSupabase()
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(429, {
        error: { message: 'Rate limited' },
      })
    )
    vi.stubGlobal('fetch', fetchImpl)

    await submitOrPollGradexAssignmentRun({
      supabase: supabase.client,
      assignment: assignment(),
      run: run({ gradex_run_id: 'gradex-run-1' }),
      items: [item({ status: 'processing' })],
    })

    expect(supabase.runUpdates).toEqual([])
    expect(supabase.itemUpdates).toEqual([
      expect.objectContaining({
        id: 'item-1',
        payload: expect.objectContaining({
          status: 'queued',
          attempt_count: 1,
          last_error_code: 'gradex_retryable_http_error',
          last_error_message: 'Gradex request failed with status 429',
          next_retry_at: expect.any(String),
          completed_at: null,
        }),
      }),
    ])
  })

  it('does not poll before a processing Gradex item retry is due', async () => {
    const supabase = buildSupabase()
    const fetchImpl = vi.fn<typeof fetch>()
    vi.stubGlobal('fetch', fetchImpl)

    await submitOrPollGradexAssignmentRun({
      supabase: supabase.client,
      assignment: assignment(),
      run: run({ gradex_run_id: 'gradex-run-1' }),
      items: [
        item({
          status: 'processing',
          attempt_count: 1,
          next_retry_at: new Date(Date.now() + 60_000).toISOString(),
        }),
      ],
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(mockBuildPikaAssignmentGradexRunPayload).not.toHaveBeenCalled()
    expect(supabase.itemUpdates).toEqual([])
    expect(supabase.runUpdates).toEqual([])
  })

  it('fails unresolved local items when Gradex ends without item results', async () => {
    const supabase = buildSupabase()
    mockMapGradexItemsToPikaGradeRecords.mockReturnValue([])
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer gx_test_key' })
      expect(String(input)).toBe('https://gradex.example.test/api/v1/grading-runs/gradex-run-1')
      return jsonResponse(200, {
        id: 'gradex-run-1',
        status: 'failed',
        counts: { requested: 1, processed: 1, completed: 0, failed: 1, skipped: 0, pending: 0 },
        provider: null,
        model: null,
        tier: null,
        policy_version: null,
        prompt_version: null,
        items: [],
      })
    })
    vi.stubGlobal('fetch', fetchImpl)

    await submitOrPollGradexAssignmentRun({
      supabase: supabase.client,
      assignment: assignment(),
      run: run({ gradex_run_id: 'gradex-run-1' }),
      items: [item({ status: 'processing' })],
    })

    expect(supabase.runUpdates).toEqual([
      expect.objectContaining({
        id: 'run-1',
        payload: expect.objectContaining({
          gradex_status: 'failed',
          gradex_last_polled_at: expect.any(String),
        }),
      }),
    ])
    expect(supabase.itemUpdates).toEqual([
      expect.objectContaining({
        id: 'item-1',
        payload: expect.objectContaining({
          status: 'failed',
          attempt_count: 1,
          last_error_code: 'gradex_item_missing',
          last_error_message: 'Gradex run ended with status failed without a result for this submission',
          completed_at: expect.any(String),
        }),
      }),
    ])
  })

  it('does not persist provider-controlled mapping failure messages or causes', async () => {
    const supabase = buildSupabase()
    mockMapGradexItemsToPikaGradeRecords.mockImplementation(() => {
      throw new Error('PRIVATE provider reference', { cause: new Error('PRIVATE student text') })
    })
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(200, {
      id: 'gradex-run-1', status: 'completed',
      counts: { requested: 1, processed: 1, completed: 1, failed: 0, skipped: 0, pending: 0 },
      provider: null, model: null, tier: null, policy_version: null, prompt_version: null, items: [],
    })))
    await submitOrPollGradexAssignmentRun({
      supabase: supabase.client, assignment: assignment(),
      run: run({ gradex_run_id: 'gradex-run-1' }), items: [item({ status: 'processing' })],
    })
    expect(supabase.itemUpdates.at(-1)?.payload).toMatchObject({
      last_error_code: 'gradex_mapping_failed', last_error_message: 'Failed to map Gradex results to Pika records',
    })
    expect(JSON.stringify(supabase.itemUpdates)).not.toContain('PRIVATE')
  })
})

function assignment() {
  return {
    id: 'assignment-1',
    classroom_id: 'classroom-1',
    title: 'Assignment One',
    description: null,
    instructions_markdown: 'Instructions',
    rich_instructions: null,
    due_at: null,
    position: 1,
    is_draft: false,
    released_at: null,
    track_authenticity: true,
    points_possible: 30,
    include_in_final: true,
    gradebook_weight: 1,
    created_by: 'teacher-1',
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
  }
}

function run(overrides: Partial<any> = {}) {
  return {
    id: 'run-1',
    assignment_id: 'assignment-1',
    status: 'running',
    triggered_by: 'teacher-1',
    model: GRADEX_ASSIGNMENT_RUN_MODEL,
    gradex_run_id: null,
    requested_student_ids_json: ['student-1'],
    selection_hash: 'selection-hash',
    requested_count: 1,
    gradable_count: 1,
    processed_count: 0,
    completed_count: 0,
    skipped_missing_count: 0,
    skipped_empty_count: 0,
    failed_count: 0,
    error_samples_json: [],
    lease_token: null,
    lease_expires_at: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

function item(overrides: Partial<any> = {}) {
  return {
    id: 'item-1',
    run_id: 'run-1',
    assignment_id: 'assignment-1',
    student_id: 'student-1',
    assignment_doc_id: 'doc-1',
    assignment_doc_updated_at: '2026-06-01T12:00:00.000Z',
    queue_position: 0,
    status: 'queued',
    skip_reason: null,
    attempt_count: 0,
    next_retry_at: null,
    last_error_code: null,
    last_error_message: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-06-01T12:00:00.000Z',
    updated_at: '2026-06-01T12:00:00.000Z',
    ...overrides,
  }
}

function buildSupabase() {
  const runUpdates: Array<{ table: string; id: string; payload: Record<string, unknown> }> = []
  const itemUpdates: Array<{ table: string; id: string; payload: Record<string, unknown> }> = []
  const aiGradeCalls: Array<Record<string, unknown>> = []

  return {
    runUpdates,
    itemUpdates,
    aiGradeCalls,
    client: {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        if (fn !== 'finalize_assignment_ai_grading_item_with_provenance_atomic') {
          throw new Error(`Unexpected RPC: ${fn}`)
        }
        aiGradeCalls.push(args)
        return {
          data: {
            docs: [{
              id: 'doc-1',
              assignment_id: 'assignment-1',
              student_id: 'student-1',
              updated_at: '2026-06-01T12:05:00.000Z',
              score_completion: args.p_score_completion,
              score_thinking: args.p_score_thinking,
              score_workflow: args.p_score_workflow,
              teacher_feedback_draft: args.p_feedback,
              teacher_feedback_draft_updated_at: args.p_now,
              graded_at: args.p_now,
              graded_by: args.p_graded_by,
            }],
          },
          error: null,
        }
      }),
      from(table: string) {
        if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [
                  {
                    id: 'doc-1',
                    student_id: 'student-1',
                    content: { type: 'doc', content: [] },
                    updated_at: '2026-06-01T12:00:00.000Z',
                    submitted_at: '2026-06-01T12:00:00.000Z',
                    authenticity_score: 88,
                    authenticity_flags: [],
                  },
                ],
                error: null,
              })),
            })),
          }
        }

        if (table === 'assignment_ai_grading_runs') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => ({
              eq: vi.fn(async (_field: string, id: string) => {
                runUpdates.push({ table, id, payload })
                return { error: null }
              }),
            })),
          }
        }

        if (table === 'assignment_ai_grading_run_items') {
          return {
            update: vi.fn((payload: Record<string, unknown>) => ({
              eq: vi.fn((_field: string, id: string) => ({
                in: vi.fn(async () => {
                  itemUpdates.push({ table, id, payload })
                  return { error: null }
                }),
              })),
            })),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      },
    },
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
