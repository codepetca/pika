import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

function buildTickHarness(opts: {
  skipReason: 'missing_doc' | 'empty_doc' | null
  model?: string
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

  mockSupabaseClient.rpc.mockImplementation(async (fn: string) => {
    if (fn === 'claim_assignment_ai_grading_run') {
      return { data: true, error: null }
    }
    if (fn === 'finalize_assignment_ai_grading_item_with_provenance_atomic') {
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

describe('createOrResumeAssignmentAiGradingRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc.mockReset()
    mockSubmitOrPollGradexAssignmentRun.mockResolvedValue(undefined)
    delete process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED
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
