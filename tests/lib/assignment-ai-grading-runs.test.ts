import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSupabaseClient } = vi.hoisted(() => ({
  mockSupabaseClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
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

function buildAssignmentDocsTable(docs: Array<{ id: string; student_id: string; content: unknown }> = []) {
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
  skipReason: 'missing_doc' | 'empty_doc'
  assignmentDoc: {
    id: string
    student_id: string
    content: unknown
    feedback: string | null
    authenticity_score: number | null
  } | null
  upsertError: unknown
}) {
  const run = {
    id: 'run-1',
    assignment_id: 'assignment-1',
    status: 'queued',
    triggered_by: 'teacher-1',
    model: 'gpt-5-nano',
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
          eq: vi.fn(async (field: string, value: string) => {
            const item = items.find((candidate) => field === 'id' && candidate.id === value)
            if (item) Object.assign(item, payload)
            return { error: null }
          }),
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

    throw new Error(`Unexpected table: ${table}`)
  })

  return { run, items }
}

describe('createOrResumeAssignmentAiGradingRun', () => {
  const originalGradexAssignmentFlag = process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED

  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc.mockReset()
    delete process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED
  })

  afterEach(() => {
    if (originalGradexAssignmentFlag === undefined) {
      delete process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED
    } else {
      process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED = originalGradexAssignmentFlag
    }
  })

  it('creates the batch through the atomic RPC with queued and skipped item rows', async () => {
    const runsTable = buildRunsTable()
    const assignmentDocsTable = buildAssignmentDocsTable([
      {
        id: 'doc-empty',
        student_id: 'student-empty',
        content: JSON.stringify({ type: 'doc', content: [] }),
      },
      {
        id: 'doc-gradable',
        student_id: 'student-gradable',
        content: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Final submission' }],
            },
          ],
        }),
      },
    ])

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable
      if (table === 'assignment_docs') return assignmentDocsTable
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
        p_model: 'gpt-5-nano',
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

  it('persists the Gradex assignment provider in the run model when the flag is enabled', async () => {
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
              content: [{ type: 'text', text: 'Final submission' }],
            },
          ],
        }),
      },
    ])

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable
      if (table === 'assignment_docs') return assignmentDocsTable
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
      last_error_message: 'Failed to save missing grade for student student-1',
    }))
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
      last_error_message: 'Failed to save missing grade for student student-1',
    }))
  })
})
