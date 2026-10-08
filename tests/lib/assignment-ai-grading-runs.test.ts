import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as aiGrading from '@/lib/ai-grading'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

const { mockLoadClassroomAiSanitizationContext, mockSubmitOrPollGradexAssignmentRun, mockSupabaseClient } = vi.hoisted(() => ({
  mockLoadClassroomAiSanitizationContext: vi.fn(),
  mockSubmitOrPollGradexAssignmentRun: vi.fn(),
  mockSupabaseClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/server/ai-sanitization', () => ({
  loadClassroomAiSanitizationContext: mockLoadClassroomAiSanitizationContext,
}))

vi.mock('@/lib/server/gradex-assignment-grading', () => ({
  GRADEX_ASSIGNMENT_RUN_MODEL: 'gradex:pika-assignment-v1',
  isGradexAssignmentGradingEnabled: () =>
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED?.trim().toLowerCase() === 'true',
  isGradexAssignmentRun: (run: { model: string | null }) => run.model === 'gradex:pika-assignment-v1',
  submitOrPollGradexAssignmentRun: mockSubmitOrPollGradexAssignmentRun,
}))

import {
  createOrResumeAssignmentAiGradingRun,
  getActiveAssignmentAiGradingRunSummary,
  tickAssignmentAiGradingRun,
} from '@/lib/server/assignment-ai-grading-runs'

function buildSelectionHash(studentIds: string[]) {
  return createHash('sha256')
    .update(Array.from(new Set(studentIds.map((studentId) => studentId.trim()).filter(Boolean))).join('|'))
    .digest('hex')
}

function buildRunsTable(activeRuns: unknown[] = []) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({
        data: activeRuns,
        error: null,
      })),
    })),
  }
}

function buildRunsTableWithSequence(activeRunBatches: unknown[][]) {
  let index = 0
  return {
    select: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => {
        const batch = activeRunBatches[Math.min(index, activeRunBatches.length - 1)] ?? []
        index += 1
        return {
          data: batch,
          error: null,
        }
      }),
    })),
  }
}

function buildAssignmentDocsTable(docs: Array<{
  id: string
  student_id: string
  content: unknown
  updated_at: string
}> = []) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      in: vi.fn(async () => ({
        data: docs,
        error: null,
      })),
    })),
  }
}

function buildAssignmentSubmissionArtifactsTable(artifacts: Array<Record<string, unknown>> = []) {
  return {
    select: vi.fn(() => ({
      in: vi.fn(async () => ({
        data: artifacts,
        error: null,
      })),
    })),
  }
}

function buildRunItemsTable(items: unknown[] = []) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn().mockReturnThis(),
      order: vi.fn(async () => ({
        data: items,
        error: null,
      })),
    })),
  }
}

describe('getActiveAssignmentAiGradingRunSummary strict evidence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([
    { data: null, error: null },
    { data: null, error: { code: 'PGRST205', message: 'missing relation' } },
  ])('rejects unavailable active-run evidence in strict mode', async (result) => {
    const runsTable = {
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(result),
      })),
    }
    const supabase = { from: vi.fn(() => runsTable) } as any

    await expect(getActiveAssignmentAiGradingRunSummary('assignment-1', {
      supabase,
      requireEvidence: true,
    })).rejects.toThrow()
  })

  it('preserves the legacy missing-schema fallback', async () => {
    const runsTable = {
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST205', message: 'missing relation' },
        }),
      })),
    }
    const supabase = { from: vi.fn(() => runsTable) } as any

    await expect(getActiveAssignmentAiGradingRunSummary('assignment-1', { supabase }))
      .resolves.toBeNull()
  })

  it('rejects a substituted active run and null run-item evidence', async () => {
    const validRun = {
      id: 'run-1',
      assignment_id: 'assignment-1',
      status: 'queued',
      model: 'gpt-5-nano',
      requested_count: 1,
      gradable_count: 1,
      processed_count: 0,
      completed_count: 0,
      skipped_missing_count: 0,
      skipped_empty_count: 0,
      failed_count: 0,
      error_samples_json: [],
      started_at: null,
      completed_at: null,
      created_at: '2026-09-01T00:00:00.000Z',
    }
    const runTable = (rows: unknown[]) => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
      })),
    })

    await expect(getActiveAssignmentAiGradingRunSummary('assignment-1', {
      supabase: {
        from: vi.fn(() => runTable([{ ...validRun, assignment_id: 'assignment-2' }])),
      } as any,
      requireEvidence: true,
    })).rejects.toThrow('Failed to verify active assignment AI grading run')

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'assignment_ai_grading_runs') return runTable([validRun])
        if (table === 'assignment_ai_grading_run_items') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }
    await expect(getActiveAssignmentAiGradingRunSummary('assignment-1', {
      supabase: supabase as any,
      requireEvidence: true,
    })).rejects.toThrow('Failed to verify assignment AI grading run items')
  })
})

function buildTickHarness(opts: {
  skipReason: 'missing_doc' | 'empty_doc' | null
  model?: string
  workerContractVersion?: number
  assignmentDoc: {
    id: string
    student_id: string
    content: unknown
    feedback: string | null
    authenticity_score: number | null
    updated_at: string
    is_submitted?: boolean | null
    submitted_at?: string | null
  } | null
  docHistory?: Array<{
    word_count: number
    paste_word_count: number | null
    trigger: string
    created_at: string
  }>
  upsertError: unknown
}) {
  const run = {
    id: 'run-1',
    assignment_id: 'assignment-1',
    status: 'queued',
    triggered_by: 'teacher-1',
    model: opts.model ?? 'gpt-5-nano',
    selection_hash: buildSelectionHash(['student-1']),
    requested_student_ids_json: ['student-1'],
    requested_count: 1,
    gradable_count: 0,
    processed_count: 0,
    completed_count: 0,
    skipped_missing_count: 0,
    skipped_empty_count: 0,
    failed_count: 0,
    error_samples_json: [],
    worker_contract_version: opts.workerContractVersion ?? 0,
    lease_token: null,
    lease_expires_at: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-04-21T12:00:00.000Z',
    updated_at: '2026-04-21T12:00:00.000Z',
  }

  const items = [
    {
      id: 'item-1',
      run_id: 'run-1',
      assignment_id: 'assignment-1',
      student_id: 'student-1',
      assignment_doc_id: opts.assignmentDoc?.id ?? null,
      assignment_doc_updated_at: opts.assignmentDoc?.updated_at ?? null,
      assignment_source_fingerprint: 'a'.repeat(64),
      gradex_submission_id: null,
      queue_position: 0,
      status: 'queued',
      skip_reason: opts.skipReason,
      attempt_count: 0,
      next_retry_at: null,
      last_error_code: null,
      last_error_message: null,
      started_at: null,
      completed_at: null,
      created_at: '2026-04-21T12:00:00.000Z',
      updated_at: '2026-04-21T12:00:00.000Z',
    },
  ]

  mockSupabaseClient.rpc.mockImplementation(async (fn: string, args: Record<string, any>) => {
    if (fn === 'get_assignment_ai_grading_usage_contract_v2') {
      return { data: {
        contract: 'assignment-ai-grading-usage', version: 2,
        source_fingerprint_version: 1, gradex_correlation_version: 1,
      }, error: null }
    }
    if (fn === 'claim_assignment_ai_grading_run') {
      run.lease_token = args.p_lease_token
      run.lease_expires_at = '2099-04-21T12:01:00.000Z'
      return { data: true, error: null }
    }
    if (fn === 'patch_assignment_ai_grading_run_with_lease_v1') {
      Object.assign(run, args.p_patch)
      return { data: { ...run }, error: null }
    }
    if (fn === 'patch_assignment_ai_grading_item_with_lease_v1') {
      const item = items.find((candidate) => candidate.id === args.p_item_id)
      if (item) Object.assign(item, args.p_patch)
      return { data: item ? { ...item } : null, error: null }
    }
    if (fn === 'reserve_assignment_ai_grading_item_usage_with_lease_v1') {
      return { data: { reservation: { operation_id: args.p_item_id, subject_user_id: run.triggered_by,
        feature_key: 'grading.ai', operation_kind: 'assignment_ai_grading',
        usage_ref: `assignment-ai-item-v1:${args.p_item_id}`, units: 1, status: 'reserved',
        expires_at: '2099-01-01T00:00:00Z' } }, error: null }
    }
    if (fn === 'skip_assignment_ai_grading_item_and_release_usage_v1'
      || fn === 'fail_assignment_ai_grading_item_and_release_usage_with_lease_v1') {
      Object.assign(items[0], { status: fn.startsWith('skip_') ? 'skipped' : 'failed',
        skip_reason: args.p_skip_reason ?? null, attempt_count: args.p_attempt_count,
        last_error_message: args.p_error_message ?? null })
      return { data: { ...items[0] }, error: null }
    }
    if (fn === 'fail_assignment_ai_grading_run_and_release_usage_with_lease_v1') {
      Object.assign(run, { status: 'failed', failed_count: 1, processed_count: 1 })
      Object.assign(items[0], { status: 'failed' })
      return { data: { ...run }, error: null }
    }
    if (fn === 'finalize_assignment_ai_grading_item_and_settle_usage_v1') {
      if (opts.upsertError) return { data: null, error: opts.upsertError }
      Object.assign(items[0], { status: 'completed', attempt_count: args.p_attempt_count })
      return { data: { docs: [{ id: 'doc-1', assignment_id: 'assignment-1', student_id: 'student-1',
        updated_at: '2026-04-21T12:00:00Z', score_completion: 7, score_thinking: 8, score_workflow: 9,
        teacher_feedback_draft: 'Feedback', teacher_feedback_draft_updated_at: null,
        graded_at: null, graded_by: null }] }, error: null }
    }
    if (
      fn === 'finalize_assignment_ai_grading_item_with_provenance_atomic'
      || fn === 'finalize_assignment_ai_grading_item_with_provenance_lease_v1'
    ) {
      return { data: null, error: opts.upsertError }
    }
    throw new Error(`Unexpected rpc: ${fn}`)
  })

  ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
    if (table === 'assignment_ai_grading_runs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn((field: string, value: string) => {
            if (field === 'id') {
              return {
                maybeSingle: vi.fn(async () => ({
                  data: value === run.id ? { ...run } : null,
                  error: null,
                })),
              }
            }

            if (field === 'assignment_id') {
              return {
                in: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(async () => ({
                      data:
                        value === run.assignment_id && ['queued', 'running'].includes(run.status)
                          ? [{ ...run }]
                          : [],
                      error: null,
                    })),
                  })),
                })),
              }
            }

            throw new Error(`Unexpected assignment_ai_grading_runs eq field: ${field}`)
          }),
        })),
        update: vi.fn((payload: Record<string, unknown>) => ({
          eq: vi.fn((field: string, value: string) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                if (field !== 'id' || value !== run.id) {
                  return { data: null, error: null }
                }
                Object.assign(run, payload)
                return { data: { ...run }, error: null }
              }),
            })),
          })),
        })),
      }
    }

    if (table === 'assignment_ai_grading_run_items') {
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
          eq: vi.fn((field: string, value: string) => ({
            in: vi.fn(async () => {
              const item = items.find((candidate) => field === 'id' && candidate.id === value)
              if (item) Object.assign(item, payload)
              return { error: null }
            }),
          })),
        })),
      }
    }

    if (table === 'assignments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: {
                id: 'assignment-1',
                title: 'Assignment One',
                classroom_id: 'classroom-1',
                due_at: '2026-04-20T23:59:00.000Z',
              },
              error: null,
            })),
          })),
        })),
      }
    }

    if (table === 'assignment_docs') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: opts.assignmentDoc ? { ...opts.assignmentDoc } : null,
              error: null,
            })),
          })),
        })),
        upsert: vi.fn(async () => ({ error: opts.upsertError })),
      }
    }

    if (table === 'assignment_submission_artifacts') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [], error: null })),
        })),
      }
    }

    if (table === 'assignment_doc_history') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(async () => ({ data: opts.docHistory ?? [], error: null })),
          })),
        })),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  return { run, items }
}

describe('metered Assignment run lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoadClassroomAiSanitizationContext.mockResolvedValue({ students: [], initialsMap: {} })
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED', 'false')
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_TEACHER_IDS', 'teacher-1')
  })
  const doc = { id: 'doc-1', student_id: 'student-1',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'I completed every part of the work and explained my answer in detail.' }] }] },
    feedback: null, authenticity_score: 50, updated_at: '2026-04-21T12:00:00Z' }
  function setup() {
    return buildTickHarness({ workerContractVersion: 1, skipReason: null, assignmentDoc: doc, upsertError: null })
  }
  const tick = () => tickAssignmentAiGradingRun({ assignmentId: 'assignment-1', runId: 'run-1' })
  it('fails closed before lease claim or provider egress when the M204 sentinel is unavailable', async () => {
    setup()
    const original = mockSupabaseClient.rpc.getMockImplementation()!
    mockSupabaseClient.rpc.mockImplementation((name, args) =>
      name === 'get_assignment_ai_grading_usage_contract_v2'
        ? Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'private missing migration' } })
        : original(name, args))
    const provider = vi.spyOn(aiGrading, 'gradeStudentWork')
    await expect(tick()).rejects.toMatchObject({ statusCode: 503, message: 'AI grading is temporarily unavailable' })
    expect(provider).not.toHaveBeenCalled()
    expect(mockSupabaseClient.rpc.mock.calls.map(([name]) => name)).not.toContain('claim_assignment_ai_grading_run')
  })

  it('reserves then settles persisted v1 even with the rollout flag off', async () => {
    const harness = setup()
    const provider = vi.spyOn(aiGrading, 'gradeStudentWork').mockResolvedValue({
      score_completion: 7, score_thinking: 8, score_workflow: 9, feedback: 'Good work', model: 'deepseek-flash',
    } as never)
    const result = await tick()
    expect(result.run.status).toBe('completed')
    expect(harness.items[0].status).toBe('completed')
    const rpcCalls = mockSupabaseClient.rpc.mock.calls
    expect(rpcCalls.map(([name]) => name)).toContain('finalize_assignment_ai_grading_item_and_settle_usage_v1')
    const reserveIndex = rpcCalls.findIndex(([name]) => name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1')
    expect(mockSupabaseClient.rpc.mock.invocationCallOrder[reserveIndex]).toBeLessThan(provider.mock.invocationCallOrder[0])
  })
  it.each([null, { ...doc, content: { type: 'doc', content: [] } }])('releases missing or blank source without a provider call', async (source) => {
    const harness = buildTickHarness({ workerContractVersion: 1, skipReason: null, assignmentDoc: source, upsertError: null })
    const provider = vi.spyOn(aiGrading, 'gradeStudentWork')
    await tick()
    expect(harness.items[0].status).toBe('skipped')
    expect(provider).not.toHaveBeenCalled()
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('skip_assignment_ai_grading_item_and_release_usage_v1', expect.anything())
  })
  it('retains the reservation on retryable provider failure then releases on exhaustion', async () => {
    const harness = setup()
    vi.spyOn(aiGrading, 'gradeStudentWork').mockRejectedValue(new aiGrading.AssignmentAiGradingError({
      kind: 'timeout', message: 'PRIVATE provider body', retryable: true,
    }))
    await tick()
    expect(harness.items[0].status).toBe('queued')
    expect(harness.items[0].last_error_message).toBe('AI grading failed')
    expect(mockSupabaseClient.rpc.mock.calls.map(([name]) => name)).not.toContain('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1')
    harness.items[0].attempt_count = 2
    harness.items[0].next_retry_at = null
    await tick()
    expect(harness.items[0].status).toBe('failed')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1', expect.objectContaining({ p_attempt_count: 3, p_release_reason: 'provider_failed' }))
  })
  it.each([
    { code: 'PGRST202', message: 'private missing contract' },
    { code: '23514', message: 'feature_usage_quota_exhausted' },
  ])('rejects admission before provider work for $code', async (error) => {
    setup()
    const original = mockSupabaseClient.rpc.getMockImplementation()!
    mockSupabaseClient.rpc.mockImplementation((name, args) => name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1'
      ? Promise.resolve({ data: null, error }) : original(name, args))
    const provider = vi.spyOn(aiGrading, 'gradeStudentWork')
    await tick()
    expect(provider).not.toHaveBeenCalled()
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1', expect.anything())
  })
  it('does not release or call the provider after lease loss', async () => {
    setup()
    const original = mockSupabaseClient.rpc.getMockImplementation()!
    mockSupabaseClient.rpc.mockImplementation((name, args) => name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1'
      ? Promise.resolve({ data: null, error: { code: '40001', message: 'Assignment AI grading lease was lost' } }) : original(name, args))
    const provider = vi.spyOn(aiGrading, 'gradeStudentWork')
    expect((await tick()).claimed).toBe(false)
    expect(provider).not.toHaveBeenCalled()
    expect(mockSupabaseClient.rpc.mock.calls.map(([name]) => name).filter((name) => name.includes('release_usage'))).toEqual([])
  })
  it.each([
    { code: '40001', message: 'metered_assignment_source_changed', reason: 'stale' },
    { code: 'PGRST202', message: 'private schema detail', reason: 'internal_failure' },
  ])('classifies pre-provider cleanup as $reason', async ({ code, message, reason }) => {
    const harness = setup()
    const original = mockSupabaseClient.rpc.getMockImplementation()!
    mockSupabaseClient.rpc.mockImplementation((name, args) => name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1'
      ? Promise.resolve({ data: null, error: { code, message } }) : original(name, args))
    const provider = vi.spyOn(aiGrading, 'gradeStudentWork')
    await tick()
    expect(provider).not.toHaveBeenCalled()
    expect(harness.items[0].status).toBe('failed')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1',
      expect.objectContaining({ p_release_reason: reason }))
  })
  it('terminates expired admission without provider work or an expired-reason fallback', async () => {
    const harness = setup()
    const original = mockSupabaseClient.rpc.getMockImplementation()!
    mockSupabaseClient.rpc.mockImplementation(async (name, args) => {
      const result = await original(name, args)
      if (name === 'reserve_assignment_ai_grading_item_usage_with_lease_v1') {
        result.data.reservation.status = 'released'
        result.data.reservation.release_reason = 'expired'
      }
      return result
    })
    const provider = vi.spyOn(aiGrading, 'gradeStudentWork')
    expect((await tick()).run.status).toBe('completed_with_errors')
    expect(harness.items[0].status).toBe('failed')
    expect(provider).not.toHaveBeenCalled()
    expect(mockSupabaseClient.rpc.mock.calls.filter(([name]) => name.includes('release_usage'))).toEqual([
      ['fail_assignment_ai_grading_item_and_release_usage_with_lease_v1', expect.objectContaining({ p_release_reason: 'internal_failure' })],
    ])
  })
  it.each(['stale', 'internal_failure'])('classifies settlement failures as %s rather than provider failures', async (reason) => {
    setup()
    vi.spyOn(aiGrading, 'gradeStudentWork').mockResolvedValue({
      score_completion: 7, score_thinking: 8, score_workflow: 9, feedback: 'Good work', model: 'deepseek-flash',
    } as never)
    const original = mockSupabaseClient.rpc.getMockImplementation()!
    mockSupabaseClient.rpc.mockImplementation((name, args) => name === 'finalize_assignment_ai_grading_item_and_settle_usage_v1'
      ? Promise.resolve({ data: null, error: reason === 'stale'
        ? { code: '40001', message: 'metered_assignment_source_changed' }
        : { code: 'PGRST202', message: 'private schema detail' } }) : original(name, args))
    await tick()
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1',
      expect.objectContaining({ p_release_reason: reason }))
  })
  it('releases the entire run on an outer fatal failure', async () => {
    setup()
    mockLoadClassroomAiSanitizationContext.mockRejectedValueOnce(new Error('PRIVATE source data'))
    expect((await tick()).run.status).toBe('failed')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('fail_assignment_ai_grading_run_and_release_usage_with_lease_v1', expect.objectContaining({ p_error_message: 'AI grading failed', p_release_reason: 'internal_failure' }))
  })
  it.each([0, 1])('conflicts with v0 and resumes matching v1 (%s)', async (version) => {
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED', 'true')
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_TEACHER_IDS', 'teacher-1')
    buildTickHarness({ workerContractVersion: version, skipReason: null, assignmentDoc: doc, upsertError: null })
    const result = await createOrResumeAssignmentAiGradingRun({ assignmentId: 'assignment-1', teacherId: 'teacher-1', studentIds: ['student-1'] })
    expect(result.kind).toBe(version === 1 ? 'resumed' : 'conflict')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledOnce()
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_assignment_ai_grading_usage_contract_v2')
  })
  it.each([1, 2])('creates %s students through metered admission only', async (count) => {
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED', 'true')
    vi.stubEnv('ASSIGNMENT_AI_GRADING_USAGE_METERING_TEACHER_IDS', 'teacher-1')
    const ids = Array.from({ length: count }, (_, i) => `student-${i + 1}`)
    mockSupabaseClient.from.mockImplementation((table) => {
      if (table === 'assignment_ai_grading_runs') return buildRunsTable()
      if (table === 'assignment_docs') return buildAssignmentDocsTable(ids.map((id) => ({ ...doc, id: `doc-${id}`, student_id: id })))
      if (table === 'assignment_submission_artifacts') return buildAssignmentSubmissionArtifactsTable()
      throw new Error(`Unexpected table ${table}`)
    })
    mockSupabaseClient.rpc.mockImplementation(async (name, args) => {
      if (name === 'get_assignment_ai_grading_usage_contract_v2') {
        return { data: { contract: 'assignment-ai-grading-usage', version: 2,
          source_fingerprint_version: 1, gradex_correlation_version: 1 }, error: null }
      }
      return { data: { id: 'run-1', assignment_id: args.p_assignment_id,
        triggered_by: args.p_teacher_id, worker_contract_version: 1, selection_hash: args.p_selection_hash,
        status: 'queued', created_at: '2026-04-21T12:00:00Z' }, error: null }
    })
    expect((await createOrResumeAssignmentAiGradingRun({ assignmentId: 'assignment-1', teacherId: 'teacher-1', studentIds: ids })).kind).toBe('created')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('create_metered_assignment_ai_grading_run_v2', expect.objectContaining({ p_gradable_count: count }))
    mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'PRIVATE RPC data' } })
    await expect(createOrResumeAssignmentAiGradingRun({ assignmentId: 'assignment-1', teacherId: 'teacher-1', studentIds: ids })).rejects.toMatchObject({ statusCode: 503 })
  })
})

describe('createOrResumeAssignmentAiGradingRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc.mockReset()
    mockSubmitOrPollGradexAssignmentRun.mockResolvedValue(undefined)
    delete process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED
    delete process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED
    delete process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_TEACHER_IDS
    mockLoadClassroomAiSanitizationContext.mockResolvedValue({
      students: [],
      initialsMap: {},
    })
  })

  it('creates the batch through the atomic RPC with queued and skipped item rows', async () => {
    const runsTable = buildRunsTable()
    const assignmentDocsTable = buildAssignmentDocsTable([
      {
        id: 'doc-empty',
        student_id: 'student-empty',
        content: JSON.stringify({ type: 'doc', content: [] }),
        updated_at: '2026-04-21T12:00:00.000Z',
      },
      {
        id: 'doc-gradable',
        student_id: 'student-gradable',
        updated_at: '2026-04-21T12:00:00.000Z',
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Final submission: I finished every task and explained my reasoning in detail below.' }],
            },
          ],
        }),
      },
    ])
    const assignmentSubmissionArtifactsTable = buildAssignmentSubmissionArtifactsTable()

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable
      if (table === 'assignment_docs') return assignmentDocsTable
      if (table === 'assignment_submission_artifacts') return assignmentSubmissionArtifactsTable
      throw new Error(`Unexpected table: ${table}`)
    })

    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        id: 'run-1',
        assignment_id: 'assignment-1',
        status: 'queued',
        created_at: '2026-04-21T12:00:00.000Z',
      },
      error: null,
    })

    const result = await createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-missing', 'student-empty', 'student-gradable'],
    })

    expect(result.kind).toBe('created')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'create_assignment_ai_grading_run_atomic',
      expect.objectContaining({
        p_assignment_id: 'assignment-1',
        p_teacher_id: 'teacher-1',
        p_model: 'deepseek-flash',
        p_requested_student_ids: ['student-missing', 'student-empty', 'student-gradable'],
        p_gradable_count: 1,
        p_skipped_missing_count: 1,
        p_skipped_empty_count: 1,
        p_now: expect.any(String),
        p_item_rows: [
          expect.objectContaining({
            student_id: 'student-missing',
            assignment_doc_id: null,
            queue_position: 0,
            status: 'skipped',
            skip_reason: 'missing_doc',
          }),
          expect.objectContaining({
            student_id: 'student-empty',
            assignment_doc_id: 'doc-empty',
            queue_position: 1,
            status: 'skipped',
            skip_reason: 'empty_doc',
          }),
          expect.objectContaining({
            student_id: 'student-gradable',
            assignment_doc_id: 'doc-gradable',
            queue_position: 2,
            status: 'queued',
            skip_reason: null,
          }),
        ],
      }),
    )
  })

  it('marks created assignment runs for Gradex when the Gradex grading flag is enabled', async () => {
    process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = 'true'
    const runsTable = buildRunsTable()
    const assignmentDocsTable = buildAssignmentDocsTable([
      {
        id: 'doc-gradable',
        student_id: 'student-gradable',
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Final submission: I finished every task and explained my reasoning in detail below.' }],
            },
          ],
        }),
      },
    ])
    const assignmentSubmissionArtifactsTable = buildAssignmentSubmissionArtifactsTable()

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable
      if (table === 'assignment_docs') return assignmentDocsTable
      if (table === 'assignment_submission_artifacts') return assignmentSubmissionArtifactsTable
      throw new Error(`Unexpected table: ${table}`)
    })

    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        id: 'run-1',
        assignment_id: 'assignment-1',
        status: 'queued',
        model: 'gradex:pika-assignment-v1',
        created_at: '2026-04-21T12:00:00.000Z',
      },
      error: null,
    })

    const result = await createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-gradable'],
    })

    expect(result.kind).toBe('created')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'create_assignment_ai_grading_run_atomic',
      expect.objectContaining({
        p_model: 'gradex:pika-assignment-v1',
      }),
    )
  })

  it('queues artifact-only submissions when creating a background grading run', async () => {
    const runsTable = buildRunsTable()
    const assignmentDocsTable = buildAssignmentDocsTable([
      {
        id: 'doc-artifact-only',
        student_id: 'student-artifact-only',
        content: JSON.stringify({ type: 'doc', content: [] }),
      },
    ])
    const assignmentSubmissionArtifactsTable = buildAssignmentSubmissionArtifactsTable([
      {
        id: 'artifact-1',
        assignment_doc_id: 'doc-artifact-only',
        requirement_id: 'requirement-1',
        student_id: 'student-artifact-only',
        type: 'link',
        url: 'https://example.com/demo',
        storage_path: null,
        metadata_json: {},
        validation_status: 'valid',
        validation_message: null,
        validated_at: '2026-05-25T12:00:00.000Z',
        created_at: '2026-05-25T12:00:00.000Z',
        updated_at: '2026-05-25T12:00:00.000Z',
      },
    ])

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable
      if (table === 'assignment_docs') return assignmentDocsTable
      if (table === 'assignment_submission_artifacts') return assignmentSubmissionArtifactsTable
      throw new Error(`Unexpected table: ${table}`)
    })

    mockSupabaseClient.rpc.mockResolvedValue({
      data: {
        id: 'run-1',
        assignment_id: 'assignment-1',
        status: 'queued',
        created_at: '2026-04-21T12:00:00.000Z',
      },
      error: null,
    })

    const result = await createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-artifact-only'],
    })

    expect(result.kind).toBe('created')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'create_assignment_ai_grading_run_atomic',
      expect.objectContaining({
        p_gradable_count: 1,
        p_skipped_empty_count: 0,
        p_item_rows: [
          expect.objectContaining({
            student_id: 'student-artifact-only',
            assignment_doc_id: 'doc-artifact-only',
            status: 'queued',
            skip_reason: null,
          }),
        ],
      }),
    )
  })

  it('resumes a matching active run without invoking the atomic RPC', async () => {
    const selectionHash = buildSelectionHash(['student-1', 'student-2'])
    const runsTable = buildRunsTable([
      {
        id: 'run-1',
        assignment_id: 'assignment-1',
        status: 'running',
        selection_hash: selectionHash,
        requested_count: 2,
        created_at: '2026-04-21T12:00:00.000Z',
      },
    ])
    const runItemsTable = buildRunItemsTable([])

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable
      if (table === 'assignment_ai_grading_run_items') return runItemsTable
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1', 'student-2'],
    })

    expect(result).toEqual({
      kind: 'resumed',
      run: expect.objectContaining({
        id: 'run-1',
        status: 'running',
      }),
    })
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('surfaces migration guidance when the atomic RPC is unavailable', async () => {
    const runsTable = buildRunsTable()
    const assignmentDocsTable = buildAssignmentDocsTable()

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable
      if (table === 'assignment_docs') return assignmentDocsTable
      throw new Error(`Unexpected table: ${table}`)
    })

    mockSupabaseClient.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.create_assignment_ai_grading_run_atomic',
      },
    })

    await expect(createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
    })).rejects.toThrow('Assignment AI grading run transaction is unavailable. Apply migration 055.')
  })

  it('maps atomic insert conflicts back to the active-run resume behavior', async () => {
    const selectionHash = buildSelectionHash(['student-1'])
    const runsTable = buildRunsTableWithSequence([
      [],
      [{
        id: 'run-1',
        assignment_id: 'assignment-1',
        status: 'queued',
        selection_hash: selectionHash,
        requested_count: 1,
        created_at: '2026-04-21T12:00:00.000Z',
      }],
    ])
    const assignmentDocsTable = buildAssignmentDocsTable()
    const runItemsTable = buildRunItemsTable([])

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable
      if (table === 'assignment_docs') return assignmentDocsTable
      if (table === 'assignment_ai_grading_run_items') return runItemsTable
      throw new Error(`Unexpected table: ${table}`)
    })

    mockSupabaseClient.rpc.mockResolvedValue({
      data: null,
      error: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "idx_assignment_ai_grading_runs_one_active"',
      },
    })

    await expect(createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
    })).resolves.toEqual({
      kind: 'resumed',
      run: expect.objectContaining({
        id: 'run-1',
        status: 'queued',
      }),
    })
  })

  it('marks a missing-doc item failed when saving the Missing grade fails', async () => {
    const harness = buildTickHarness({
      workerContractVersion: 0,
      skipReason: 'missing_doc',
      assignmentDoc: null,
      upsertError: { message: 'upsert failed' },
    })

    const result = await tickAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      runId: 'run-1',
    })

    expect(result.claimed).toBe(true)
    expect(result.run).toEqual(expect.objectContaining({
      status: 'completed_with_errors',
      failed_count: 1,
      skipped_missing_count: 0,
    }))
    expect(harness.items[0]).toEqual(expect.objectContaining({
      status: 'failed',
      skip_reason: null,
      attempt_count: 1,
      last_error_code: 'save_missing_grade_failed',
      last_error_message: 'Failed to finalize AI assignment grade',
    }))
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'finalize_assignment_ai_grading_item_with_provenance_atomic',
      expect.objectContaining({ p_item_id: 'item-1' }),
    )
  })

  it('fails a legacy queued item closed when its source revision is unavailable', async () => {
    const harness = buildTickHarness({
      skipReason: 'empty_doc',
      assignmentDoc: {
        id: 'doc-1',
        student_id: 'student-1',
        content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }),
        feedback: null,
        authenticity_score: null,
        updated_at: '2026-04-21T12:00:00.000Z',
      },
      upsertError: null,
    })
    harness.items[0]!.assignment_doc_updated_at = null

    const result = await tickAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      runId: 'run-1',
    })

    expect(result.run).toEqual(expect.objectContaining({
      status: 'completed_with_errors',
      failed_count: 1,
    }))
    expect(harness.items[0]).toEqual(expect.objectContaining({
      status: 'failed',
      last_error_code: 'source_revision_unavailable',
    }))
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalledWith(
      'save_assignment_ai_grade_with_provenance_atomic',
      expect.anything(),
    )
  })

  it('delegates Gradex-marked runs to the Gradex assignment processor', async () => {
    const harness = buildTickHarness({
      model: 'gradex:pika-assignment-v1',
      skipReason: 'empty_doc',
      assignmentDoc: {
        id: 'doc-1',
        student_id: 'student-1',
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Final submission: I finished every task and explained my reasoning in detail below.' }],
            },
          ],
        }),
        feedback: null,
        authenticity_score: null,
        updated_at: '2026-04-21T12:00:00.000Z',
      },
      upsertError: null,
    })

    const result = await tickAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      runId: 'run-1',
    })

    expect(result.claimed).toBe(true)
    expect(result.run).toEqual(expect.objectContaining({
      id: 'run-1',
      status: 'running',
    }))
    expect(mockSubmitOrPollGradexAssignmentRun).toHaveBeenCalledWith({
      supabase: mockSupabaseClient,
      assignment: expect.objectContaining({ id: 'assignment-1' }),
      run: expect.objectContaining({ id: 'run-1', model: 'gradex:pika-assignment-v1' }),
      items: harness.items,
      leaseToken: expect.any(String),
      leaseFencingEnabled: false,
    })
  })

  it('adds process points to the grader presentation score and appends reminders', async () => {
    const originalApiKey = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'synthetic-key'
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: '{"score_completion":9,"score_thinking":8,"score_workflow":4,"feedback":"Strength: Clear work.\\nNext Step: Add detail."}',
        },
        finish_reason: 'stop',
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    try {
      buildTickHarness({
        skipReason: null,
        assignmentDoc: {
          id: 'doc-1',
          student_id: 'student-1',
          content: JSON.stringify({
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'My finished work covers every part of this assignment in detail.' }] }],
          }),
          feedback: null,
          authenticity_score: null,
          updated_at: '2026-04-21T12:00:00.000Z',
          // Five days after the due date: -2 for lateness.
          is_submitted: true,
          submitted_at: '2026-04-25T23:59:00.000Z',
        },
        // Everything arrives in one paste: authenticity 0, so 0 of 2 there.
        docHistory: [
          { word_count: 0, paste_word_count: 0, trigger: 'autosave', created_at: '2026-04-25T23:50:00.000Z' },
          { word_count: 400, paste_word_count: 400, trigger: 'autosave', created_at: '2026-04-25T23:50:05.000Z' },
        ],
        upsertError: null,
      })

      await tickAssignmentAiGradingRun({ assignmentId: 'assignment-1', runId: 'run-1' })

      const call = mockSupabaseClient.rpc.mock.calls.find(
        ([fn]) => fn === 'finalize_assignment_ai_grading_item_with_provenance_atomic',
      )
      const payload = call?.[1] as Record<string, unknown>
      // presentation 4 + on time 2 - late 2 + sittings 2 + authenticity 0
      expect(payload.p_score_workflow).toBe(6)
      expect(payload.p_score_completion).toBe(9)
      expect(payload.p_score_thinking).toBe(8)
      expect(String(payload.p_feedback)).toContain('Strength: Clear work.')
      expect(String(payload.p_feedback)).toContain('type all of your work directly in Pika')
    } finally {
      process.env.DEEPSEEK_API_KEY = originalApiKey
      vi.unstubAllGlobals()
    }
  })

  it('marks an empty-doc item failed when saving the Missing grade fails', async () => {
    const harness = buildTickHarness({
      skipReason: 'empty_doc',
      assignmentDoc: {
        id: 'doc-1',
        student_id: 'student-1',
        content: JSON.stringify({ type: 'doc', content: [] }),
        feedback: null,
        authenticity_score: null,
        updated_at: '2026-04-21T12:00:00.000Z',
      },
      upsertError: { message: 'upsert failed' },
    })

    const result = await tickAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      runId: 'run-1',
    })

    expect(result.claimed).toBe(true)
    expect(result.run).toEqual(expect.objectContaining({
      status: 'completed_with_errors',
      failed_count: 1,
      skipped_empty_count: 0,
    }))
    expect(harness.items[0]).toEqual(expect.objectContaining({
      status: 'failed',
      skip_reason: null,
      attempt_count: 1,
      last_error_code: 'save_missing_grade_failed',
      last_error_message: 'Failed to finalize AI assignment grade',
    }))
  })

  it.each(['http', 'json', 'output', 'network'])('does not persist private provider content on %s failure', async (stage) => {
    const originalApiKey = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'synthetic-key'
    const privateMarker = 'PRIVATE synthetic@example.invalid code-123456 student-work'
    const fetchMock = vi.fn()
    if (stage === 'network') fetchMock.mockRejectedValue(new Error(privateMarker))
    else fetchMock.mockResolvedValue(new Response(
      stage === 'output'
        ? JSON.stringify({ choices: [{ message: { content: privateMarker }, finish_reason: 'stop' }] })
        : privateMarker,
      { status: stage === 'http' ? 400 : 200 },
    ))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const harness = buildTickHarness({
        skipReason: null,
        assignmentDoc: {
          id: 'doc-1', student_id: 'student-1',
          content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph',
            content: [{ type: 'text', text: 'Synthetic submission: this fixture body is long enough to count as real work.' }] }] }),
          feedback: null, authenticity_score: null, updated_at: '2026-04-21T12:00:00.000Z',
        },
        upsertError: null,
      })
      const result = await tickAssignmentAiGradingRun({ assignmentId: 'assignment-1', runId: 'run-1' })
      expect(result.claimed).toBe(true)
      expect(harness.items[0]).toMatchObject({
        status: stage === 'network' ? 'queued' : 'failed',
        last_error_code: stage === 'output' ? 'invalid_output' : stage === 'network' ? 'network' : 'bad_response',
        last_error_message: stage === 'http' ? 'DeepSeek request failed (400)'
          : stage === 'json' ? 'DeepSeek returned invalid JSON (status 200)'
            : stage === 'output' ? 'Grading provider returned invalid output' : 'DeepSeek request failed',
      })
      expect(JSON.stringify(harness.items)).not.toContain(privateMarker)
      expect(JSON.stringify(result)).not.toContain(privateMarker)
    } finally {
      process.env.DEEPSEEK_API_KEY = originalApiKey
      vi.unstubAllGlobals()
    }
  })

  it('requeues an item when the provider response body times out', async () => {
    const originalApiKey = process.env.DEEPSEEK_API_KEY
    process.env.DEEPSEEK_API_KEY = 'test-key'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new DOMException('The operation was aborted', 'AbortError')),
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const harness = buildTickHarness({
        skipReason: null,
        assignmentDoc: {
          id: 'doc-1',
          student_id: 'student-1',
          content: JSON.stringify({
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Final submission: I finished every task and explained my reasoning in detail below.' }],
              },
            ],
          }),
          feedback: null,
          authenticity_score: null,
          updated_at: '2026-04-21T12:00:00.000Z',
        },
        upsertError: null,
      })

      const result = await tickAssignmentAiGradingRun({
        assignmentId: 'assignment-1',
        runId: 'run-1',
      })

      expect(result.claimed).toBe(true)
      expect(result.run).toEqual(expect.objectContaining({
        status: 'running',
        processed_count: 0,
        failed_count: 0,
        next_retry_at: harness.items[0]!.next_retry_at,
      }))
      expect(harness.items[0]).toEqual(expect.objectContaining({
        status: 'queued',
        attempt_count: 1,
        last_error_code: 'timeout',
        last_error_message: 'DeepSeek grading response timed out',
        completed_at: null,
      }))
      expect(new Date(harness.items[0]!.next_retry_at!).getTime()).toBeGreaterThan(Date.now())
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.deepseek.com/chat/completions',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      )
    } finally {
      process.env.DEEPSEEK_API_KEY = originalApiKey
      vi.unstubAllGlobals()
    }
  })
})
