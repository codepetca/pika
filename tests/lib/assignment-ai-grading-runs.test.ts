import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSupabaseClient } = vi.hoisted(() => ({
  mockSupabaseClient: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

import { createOrResumeAssignmentAiGradingRun } from '@/lib/server/assignment-ai-grading-runs'

function buildAssignmentDocsTable(opts: {
  docs?: Array<{ id: string; student_id: string; content: unknown }>
  upsertError?: unknown
  operationLog?: string[]
}) {
  const upsert = vi.fn(async () => {
    opts.operationLog?.push('missing-grade-upsert')
    return { error: opts.upsertError ?? null }
  })

  return {
    table: {
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        in: vi.fn(async () => ({
          data: opts.docs ?? [],
          error: null,
        })),
      })),
      upsert,
    },
    upsert,
  }
}

function buildRunsTable(opts: {
  activeRuns?: unknown[]
  insertError?: unknown
  operationLog?: string[]
}) {
  const insert = vi.fn((payload: Record<string, unknown>) => {
    opts.operationLog?.push('insert-run')
    return {
      select: vi.fn(() => ({
        single: vi.fn(async () => ({
          data: opts.insertError
            ? null
            : {
                id: 'run-1',
                created_at: '2026-04-21T12:00:00.000Z',
                ...payload,
              },
          error: opts.insertError ?? null,
        })),
      })),
    }
  })

  return {
    table: {
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn(async () => ({
          data: opts.activeRuns ?? [],
          error: null,
        })),
      })),
      insert,
    },
    insert,
  }
}

function buildRunItemsTable(opts?: {
  insertError?: unknown
  operationLog?: string[]
}) {
  const insert = vi.fn(async () => {
    opts?.operationLog?.push('insert-run-items')
    return { error: opts?.insertError ?? null }
  })

  return {
    table: { insert },
    insert,
  }
}

describe('createOrResumeAssignmentAiGradingRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not persist missing grades when run creation fails', async () => {
    const operationLog: string[] = []
    const assignmentDocsTable = buildAssignmentDocsTable({ operationLog })
    const runsTable = buildRunsTable({
      insertError: { message: 'insert failed' },
      operationLog,
    })
    const runItemsTable = buildRunItemsTable({ operationLog })

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable.table
      if (table === 'assignment_docs') return assignmentDocsTable.table
      if (table === 'assignment_ai_grading_run_items') return runItemsTable.table
      throw new Error(`Unexpected table: ${table}`)
    })

    await expect(createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
    })).rejects.toThrow('Failed to create assignment AI grading run')

    expect(assignmentDocsTable.upsert).not.toHaveBeenCalled()
    expect(runItemsTable.insert).not.toHaveBeenCalled()
    expect(operationLog).toEqual(['insert-run'])
  })

  it('does not persist missing grades when run item creation fails', async () => {
    const operationLog: string[] = []
    const assignmentDocsTable = buildAssignmentDocsTable({ operationLog })
    const runsTable = buildRunsTable({ operationLog })
    const runItemsTable = buildRunItemsTable({
      insertError: { message: 'insert failed' },
      operationLog,
    })

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable.table
      if (table === 'assignment_docs') return assignmentDocsTable.table
      if (table === 'assignment_ai_grading_run_items') return runItemsTable.table
      throw new Error(`Unexpected table: ${table}`)
    })

    await expect(createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
    })).rejects.toThrow('Failed to create assignment AI grading run items')

    expect(assignmentDocsTable.upsert).not.toHaveBeenCalled()
    expect(operationLog).toEqual(['insert-run', 'insert-run-items'])
  })

  it('persists missing grades only after the run and items exist', async () => {
    const operationLog: string[] = []
    const assignmentDocsTable = buildAssignmentDocsTable({ operationLog })
    const runsTable = buildRunsTable({ operationLog })
    const runItemsTable = buildRunItemsTable({ operationLog })

    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'assignment_ai_grading_runs') return runsTable.table
      if (table === 'assignment_docs') return assignmentDocsTable.table
      if (table === 'assignment_ai_grading_run_items') return runItemsTable.table
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await createOrResumeAssignmentAiGradingRun({
      assignmentId: 'assignment-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1'],
    })

    expect(result.kind).toBe('created')
    expect(assignmentDocsTable.upsert).toHaveBeenCalledOnce()
    expect(operationLog).toEqual(['insert-run', 'insert-run-items', 'missing-grade-upsert'])
  })
})
