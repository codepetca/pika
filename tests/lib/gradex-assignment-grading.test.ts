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
  submitOrPollGradexAssignmentRun as submitOrPollGradexAssignmentRunWithLease,
} from '@/lib/server/gradex-assignment-grading'

function submitOrPollGradexAssignmentRun(opts: Record<string, unknown>) {
  return submitOrPollGradexAssignmentRunWithLease({
    ...opts,
    leaseToken: 'lease-1',
    leaseFencingEnabled: opts.leaseFencingEnabled === true,
  } as Parameters<typeof submitOrPollGradexAssignmentRunWithLease>[0])
}

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

  function meteredSetup() {
    const docs = [1, 2].map((n) => ({ id: `doc-${n}`, student_id: `student-${n}`,
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'This is a complete submission with at least ten words and detailed explanations.' }] }] },
      updated_at: '2026-06-01T12:00:00Z' }))
    const supabase = buildSupabase(docs)
    const built = mockBuildPikaAssignmentGradexRunPayload()
    built.gradexRequest.submissions = docs.map((doc) => ({ external_submission_id: `safe-${doc.id}`, external_student_id: 'safe-student', content_type: 'text', content: 'Sanitized work' }))
    built.gradexRequest.workflow_evidence_by_submission_id = Object.fromEntries(docs.map((doc) => [`safe-${doc.id}`, {}]))
    built.mappings = docs.map((doc) => ({ assignment_doc_id: doc.id, student_id: doc.student_id,
      gradex_submission_id: `safe-${doc.id}` }))
    mockBuildPikaAssignmentGradexRunPayload.mockReturnValue(built)
    const items = [
      item({ gradex_submission_id: 'safe-doc-1' }),
      item({ id: 'item-2', assignment_doc_id: 'doc-2', student_id: 'student-2', gradex_submission_id: 'safe-doc-2' }),
    ]
    const opts = { supabase: supabase.client, assignment: assignment(), run: run({ worker_contract_version: 1 }), items }
    return { supabase, opts, docs }
  }

  const remoteRun = (status = 'queued') => ({ id: 'remote-1', status,
    counts: { requested: 2, processed: status === 'queued' ? 0 : 2, completed: status === 'queued' ? 0 : 1, failed: 0, skipped: 0, pending: status === 'queued' ? 2 : 0 },
    provider: null, model: null, tier: null, policy_version: null, prompt_version: null, items: [] })

  it('sends only admitted metered items and their workflow evidence to Gradex', async () => {
    const { supabase, opts } = meteredSetup()
    const original = supabase.client.rpc.getMockImplementation()!
    supabase.client.rpc.mockImplementation(async (name, args) => {
      if (name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1' && args.p_item_id === 'item-2') {
        return { data: null, error: { code: '23514', message: 'feature_usage_quota_exhausted' } } as never
      }
      return original(name, args)
    })
    const fetcher = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init.body))
      expect(body.submissions.map((entry: any) => entry.external_submission_id)).toEqual(['safe-doc-1'])
      expect(Object.keys(body.workflow_evidence_by_submission_id)).toEqual(['safe-doc-1'])
      return jsonResponse(202, remoteRun())
    })
    vi.stubGlobal('fetch', fetcher)
    await submitOrPollGradexAssignmentRun(opts)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(supabase.client.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1', expect.objectContaining({ p_item_id: 'item-2' }))
    expect(supabase.client.rpc.mock.calls.filter(([name]) => name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1')).toHaveLength(2)
  })

  it('reuses durable Gradex correlation when newly generated pseudonyms change', async () => {
    const { supabase, opts, docs } = meteredSetup()
    opts.run.gradex_idempotency_key = 'pika-run-original-salt'
    const rotated = mockBuildPikaAssignmentGradexRunPayload()
    rotated.gradexRequest.submissions = docs.map((doc) => ({
      external_submission_id: `rotated-${doc.id}`,
      external_student_id: 'rotated-student',
      content_type: 'text',
      content: 'Sanitized work',
    }))
    rotated.gradexRequest.workflow_evidence_by_submission_id = Object.fromEntries(
      docs.map((doc) => [`rotated-${doc.id}`, {}]),
    )
    rotated.mappings = docs.map((doc) => ({
      assignment_doc_id: doc.id,
      student_id: doc.student_id,
      gradex_submission_id: `rotated-${doc.id}`,
    }))
    mockBuildPikaAssignmentGradexRunPayload.mockReturnValue(rotated)
    const fetcher = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init.body))
      expect(body.assignment.metadata.idempotency_key).toBe('pika-run-original-salt')
      expect(body.submissions.map((entry: any) => entry.external_submission_id))
        .toEqual(['safe-doc-1', 'safe-doc-2'])
      expect(Object.keys(body.workflow_evidence_by_submission_id))
        .toEqual(['safe-doc-1', 'safe-doc-2'])
      return jsonResponse(202, remoteRun())
    })
    vi.stubGlobal('fetch', fetcher)

    await submitOrPollGradexAssignmentRun(opts)

    expect(supabase.client.rpc).toHaveBeenCalledWith(
      'prepare_assignment_ai_gradex_submission_v1',
      expect.objectContaining({
        p_idempotency_key: 'pika-run-original-salt',
        p_item_refs: [
          { item_id: 'item-1', external_submission_id: 'safe-doc-1' },
          { item_id: 'item-2', external_submission_id: 'safe-doc-2' },
        ],
      }),
    )
  })

  it('does not fetch Gradex item details for a local reservation that is no longer live', async () => {
    const { supabase, opts } = meteredSetup()
    opts.run.gradex_run_id = 'remote-1'
    const original = supabase.client.rpc.getMockImplementation()!
    supabase.client.rpc.mockImplementation((name, args) => {
      if (name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1' && args.p_item_id === 'item-2') {
        return Promise.resolve({ data: null, error: { code: '23514', message: 'feature_usage_quota_exhausted' } }) as never
      }
      return original(name, args)
    })
    const fetchedUrls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input) => {
      const url = String(input)
      fetchedUrls.push(url)
      if (url.endsWith('/grading-runs/remote-1')) {
        return jsonResponse(200, {
          ...remoteRun('completed'),
          items: [
            { id: 'remote-item-1', status: 'completed', external_submission_id: 'safe-doc-1', external_student_id: 'safe-student', error: null },
            { id: 'remote-item-2', status: 'completed', external_submission_id: 'safe-doc-2', external_student_id: 'safe-student', error: null },
          ],
        })
      }
      if (url.endsWith('/items/remote-item-1')) {
        return jsonResponse(200, {
          id: 'remote-item-1', status: 'completed', external_submission_id: 'safe-doc-1',
          external_student_id: 'safe-student', error: null,
          result: { provider: 'test', model: 'test-model', tier: 'test-tier',
            policy_version: 'test-policy', prompt_version: 'test-prompt',
            audit_id: 'test-audit', token_usage: null },
        })
      }
      throw new Error(`Unexpected provider request: ${url}`)
    }))
    mockBuildPikaAssignmentGradexRunPayload.mockImplementation(({ assignmentDocs }) => {
      const built = {
        gradexRequest: { assignment: {}, rubric: {}, settings: {}, submissions: [], workflow_evidence_by_submission_id: {} },
        mappings: assignmentDocs.map((doc: any) => ({ assignment_doc_id: doc.id, student_id: doc.student_id,
          gradex_submission_id: `generated-${doc.id}` })),
      }
      return built as never
    })
    mockMapGradexItemsToPikaGradeRecords.mockReturnValue([])

    await submitOrPollGradexAssignmentRun(opts)

    expect(fetchedUrls).toContain('https://gradex.example.test/api/v1/grading-runs/remote-1/items/remote-item-1')
    expect(fetchedUrls.some((url) => url.endsWith('/items/remote-item-2'))).toBe(false)
  })

  it.each([0, 2])('retains retry reservations and releases exhausted Gradex items (attempt %s)', async (attempt) => {
    const { supabase, opts } = meteredSetup()
    opts.items.forEach((entry) => { entry.attempt_count = attempt })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })))
    await submitOrPollGradexAssignmentRun(opts)
    expect(supabase.client.rpc.mock.calls.filter(([name]) => name === 'fail_assignment_ai_grading_item_and_release_usage_with_lease_v1')).toHaveLength(attempt === 2 ? 2 : 0)
    if (attempt === 0) expect(supabase.itemUpdates.filter(({ payload }) => payload.status === 'queued')).toHaveLength(2)
    if (attempt === 2) expect(supabase.client.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1',
      expect.objectContaining({ p_release_reason: 'provider_failed' }))
  })

  it('rejects expired Gradex admission with per-item terminal cleanup and no provider call', async () => {
    const { supabase, opts } = meteredSetup()
    const original = supabase.client.rpc.getMockImplementation()!
    supabase.client.rpc.mockImplementation(async (name, args) => {
      const result = await original(name, args)
      if (name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1') {
        result.data.reservation.status = 'released'
        result.data.reservation.release_reason = 'expired'
      }
      return result
    })
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await submitOrPollGradexAssignmentRun(opts)
    expect(fetcher).not.toHaveBeenCalled()
    const failures = supabase.client.rpc.mock.calls.filter(([name]) => name.includes('release_usage'))
    expect(failures).toHaveLength(2)
    for (const [name, args] of failures) {
      expect(name).toBe('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1')
      expect(args.p_release_reason).toBe('internal_failure')
    }
  })

  it.each([
    ['reserve_assignment_ai_grading_item_usage_with_lease_v1', '40001', 'metered_assignment_source_changed', 'stale'],
    ['reserve_assignment_ai_grading_item_usage_with_lease_v1', 'PGRST202', 'private contract detail', 'internal_failure'],
    ['finalize_assignment_ai_grading_item_and_settle_usage_v1', '40001', 'metered_assignment_source_changed', 'stale'],
    ['finalize_assignment_ai_grading_item_and_settle_usage_v1', 'PGRST202', 'private contract detail', 'internal_failure'],
  ])('classifies Gradex %s failures as %s/%s/%s', async (rpcName, code, message, reason) => {
    const { supabase, opts } = meteredSetup()
    opts.run.gradex_run_id = 'remote-1'
    const original = supabase.client.rpc.getMockImplementation()!
    supabase.client.rpc.mockImplementation((name, args) => name === rpcName
      ? Promise.resolve({ data: null, error: { code, message } }) as never : original(name, args))
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(200, remoteRun('completed')))
    vi.stubGlobal('fetch', fetcher)
    mockMapGradexItemsToPikaGradeRecords.mockReturnValue([1, 2].map((n) => ({
      assignment_doc_id: `doc-${n}`, status: 'completed', score_completion: 7, score_thinking: 8,
      score_workflow: 9, feedback: 'Good work', model: 'test',
    })))
    await submitOrPollGradexAssignmentRun(opts)
    expect(fetcher).toHaveBeenCalledTimes(rpcName.startsWith('reserve') ? 0 : 1)
    expect(supabase.client.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1',
      expect.objectContaining({ p_release_reason: reason }))
  })

  it('settles each completed Gradex item and releases each failed item after the gate turns off', async () => {
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED', 'false')
    const { supabase, opts } = meteredSetup()
    opts.run.gradex_run_id = 'remote-1'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, remoteRun('completed_with_errors'))))
    mockMapGradexItemsToPikaGradeRecords.mockReturnValue([
      { assignment_doc_id: 'doc-1', status: 'completed', score_completion: 7, score_thinking: 8,
        score_workflow: 9, feedback: 'Good work', model: 'test' },
      { assignment_doc_id: 'doc-2', status: 'failed' },
    ])
    await submitOrPollGradexAssignmentRun(opts)
    expect(supabase.client.rpc).toHaveBeenCalledWith('finalize_assignment_ai_grading_item_and_settle_usage_v1', expect.objectContaining({ p_item_id: 'item-1' }))
    expect(supabase.client.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1', expect.objectContaining({ p_item_id: 'item-2' }))
    expect(supabase.aiGradeCalls).toHaveLength(1)
  })

  it('waits for sibling terminal persistence before surfacing a lease-loss failure', async () => {
    const { supabase, opts } = meteredSetup()
    opts.run.gradex_run_id = 'remote-1'
    let siblingSettled = false
    const original = supabase.client.rpc.getMockImplementation()!
    supabase.client.rpc.mockImplementation(async (name, args) => {
      if (name === 'finalize_assignment_ai_grading_item_and_settle_usage_v1') {
        if (args.p_item_id === 'item-1') {
          return { data: null, error: { code: '40001', message: 'Assignment AI grading lease was lost' } } as never
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
        siblingSettled = true
      }
      return original(name, args)
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, remoteRun('completed'))))
    mockMapGradexItemsToPikaGradeRecords.mockReturnValue([1, 2].map((n) => ({
      assignment_doc_id: `doc-${n}`, status: 'completed', score_completion: 7,
      score_thinking: 8, score_workflow: 9, feedback: 'Good work', model: 'test',
    })))

    await expect(submitOrPollGradexAssignmentRun(opts))
      .rejects.toMatchObject({ message: 'Assignment AI grading worker lease was lost' })
    expect(siblingSettled).toBe(true)
    expect(supabase.aiGradeCalls).toEqual([
      expect.objectContaining({ p_item_id: 'item-2' }),
    ])
  })

  it('skips blank and missing Gradex sources without provider work', async () => {
    const { supabase, opts, docs } = meteredSetup()
    docs[0].content.content = []
    docs.pop()
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await submitOrPollGradexAssignmentRun(opts)
    expect(fetcher).not.toHaveBeenCalled()
    expect(supabase.client.rpc).toHaveBeenCalledWith('skip_assignment_ai_grading_item_and_release_usage_v1', expect.objectContaining({ p_item_id: 'item-1', p_skip_reason: 'empty_doc' }))
    expect(supabase.client.rpc).toHaveBeenCalledWith('skip_assignment_ai_grading_item_and_release_usage_v1', expect.objectContaining({ p_item_id: 'item-2', p_skip_reason: 'missing_doc' }))
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
      leaseFencingEnabled: true,
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
    expect(supabase.client.rpc).toHaveBeenCalledWith(
      'patch_assignment_ai_grading_item_with_lease_v1',
      expect.objectContaining({ p_lease_token: 'lease-1' }),
    )
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
    gradex_idempotency_key: null,
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
    assignment_source_fingerprint: 'a'.repeat(64),
    gradex_submission_id: null,
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

function buildSupabase(docs?: unknown[]) {
  const runUpdates: Array<{ table: string; id: string; payload: Record<string, unknown> }> = []
  const itemUpdates: Array<{ table: string; id: string; payload: Record<string, unknown> }> = []
  const aiGradeCalls: Array<Record<string, unknown>> = []

  return {
    runUpdates,
    itemUpdates,
    aiGradeCalls,
    client: {
      rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
        if (fn === 'reserve_assignment_ai_grading_item_usage_with_lease_v1') {
          return { data: { reservation: { operation_id: args.p_item_id, subject_user_id: 'teacher-1',
            feature_key: 'grading.ai', operation_kind: 'assignment_ai_grading',
            usage_ref: `assignment-ai-item-v1:${args.p_item_id}`, units: 1, status: 'reserved', expires_at: '2099-01-01T00:00:00Z' } }, error: null }
        }
        if (fn === 'prepare_assignment_ai_gradex_submission_v1') {
          return { data: {
            run_id: args.p_run_id,
            idempotency_key: args.p_idempotency_key,
            prepared_count: (args.p_item_refs as unknown[]).length,
          }, error: null }
        }
        if (fn === 'record_assignment_ai_gradex_submission_v1') {
          const payload = {
            gradex_run_id: args.p_gradex_run_id,
            gradex_status: args.p_gradex_status,
            gradex_idempotency_key: args.p_idempotency_key,
            gradex_submitted_at: args.p_submitted_at,
            gradex_last_polled_at: args.p_last_polled_at,
          }
          runUpdates.push({ table: 'assignment_ai_grading_runs', id: args.p_run_id as string, payload })
          return { data: run(payload), error: null }
        }
        if (fn === 'skip_assignment_ai_grading_item_and_release_usage_v1' || fn === 'fail_assignment_ai_grading_item_and_release_usage_with_lease_v1') {
          return { data: item({ id: args.p_item_id, status: fn.startsWith('skip_') ? 'skipped' : 'failed' }), error: null }
        }
        if (fn === 'patch_assignment_ai_grading_item_with_lease_v1') {
          itemUpdates.push({
            table: 'assignment_ai_grading_run_items',
            id: args.p_item_id as string,
            payload: args.p_patch as Record<string, unknown>,
          })
          return { data: item(args.p_patch as Record<string, unknown>), error: null }
        }
        if (fn === 'patch_assignment_ai_grading_run_with_lease_v1') {
          runUpdates.push({
            table: 'assignment_ai_grading_runs',
            id: args.p_run_id as string,
            payload: args.p_patch as Record<string, unknown>,
          })
          return { data: run(args.p_patch as Record<string, unknown>), error: null }
        }
        if (fn === 'finalize_assignment_ai_grading_item_with_provenance_atomic' || fn === 'finalize_assignment_ai_grading_item_and_settle_usage_v1') {
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
        }
        throw new Error(`Unexpected RPC: ${fn}`)
      }),
      from(table: string) {
        if (table === 'assignment_docs') {
          return {
            select: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: docs ?? [
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
              eq: vi.fn((_field: string, id: string) => {
                runUpdates.push({ table, id, payload })
                return {
                  select: vi.fn(() => ({
                    single: vi.fn(async () => ({
                      data: run(payload),
                      error: null,
                    })),
                  })),
                }
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
