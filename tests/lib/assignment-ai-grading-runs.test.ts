import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSupabaseClient } = vi.hoisted(() => ({
  mockSupabaseClient: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

import { createOrResumeAssignmentAiGradingRun } from '@/lib/server/assignment-ai-grading-runs'

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

describe('createOrResumeAssignmentAiGradingRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc.mockReset()
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
})
