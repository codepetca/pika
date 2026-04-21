import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getAssignmentAiGradingRunSummary, tickAssignmentAiGradingRun } = vi.hoisted(() => ({
  getAssignmentAiGradingRunSummary: vi.fn(),
  tickAssignmentAiGradingRun: vi.fn(),
}))

const { assertTeacherOwnsAssignment } = vi.hoisted(() => ({
  assertTeacherOwnsAssignment: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherOwnsAssignment,
}))

vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  getAssignmentAiGradingRunSummary,
  tickAssignmentAiGradingRun,
}))

import { GET } from '@/app/api/teacher/assignments/[id]/auto-grade-runs/[runId]/route'
import { POST } from '@/app/api/teacher/assignments/[id]/auto-grade-runs/[runId]/tick/route'

describe('assignment auto-grade run routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertTeacherOwnsAssignment.mockResolvedValue({
      id: 'assignment-1',
      classroom_id: 'classroom-1',
      classrooms: { teacher_id: 'teacher-1' },
    })
  })

  it('returns the current run summary', async () => {
    getAssignmentAiGradingRunSummary.mockResolvedValue({
      id: 'run-1',
      assignment_id: 'assignment-1',
      status: 'running',
      model: 'gpt-5-nano',
      requested_count: 4,
      gradable_count: 3,
      processed_count: 1,
      completed_count: 1,
      skipped_missing_count: 0,
      skipped_empty_count: 0,
      failed_count: 0,
      pending_count: 3,
      next_retry_at: null,
      error_samples: [],
      started_at: '2026-04-20T12:00:00.000Z',
      completed_at: null,
      created_at: '2026-04-20T12:00:00.000Z',
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade-runs/run-1'),
      { params: Promise.resolve({ id: 'assignment-1', runId: 'run-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.run).toEqual(
      expect.objectContaining({
        id: 'run-1',
        status: 'running',
        requested_count: 4,
      }),
    )
  })

  it('ticks a run and returns the updated summary', async () => {
    tickAssignmentAiGradingRun.mockResolvedValue({
      claimed: true,
      run: {
        id: 'run-1',
        assignment_id: 'assignment-1',
        status: 'completed',
        model: 'gpt-5-nano',
        requested_count: 4,
        gradable_count: 3,
        processed_count: 4,
        completed_count: 3,
        skipped_missing_count: 1,
        skipped_empty_count: 0,
        failed_count: 0,
        pending_count: 0,
        next_retry_at: null,
        error_samples: [],
        started_at: '2026-04-20T12:00:00.000Z',
        completed_at: '2026-04-20T12:02:00.000Z',
        created_at: '2026-04-20T12:00:00.000Z',
      },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/assignments/assignment-1/auto-grade-runs/run-1/tick', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'assignment-1', runId: 'run-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      claimed: true,
      run: expect.objectContaining({
        id: 'run-1',
        status: 'completed',
        completed_count: 3,
      }),
    })
    expect(tickAssignmentAiGradingRun).toHaveBeenCalledWith({
      assignmentId: 'assignment-1',
      runId: 'run-1',
    })
  })
})
