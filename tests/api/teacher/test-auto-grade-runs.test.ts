import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { getTestAiGradingRunSummary, tickTestAiGradingRun } = vi.hoisted(() => ({
  getTestAiGradingRunSummary: vi.fn(),
  tickTestAiGradingRun: vi.fn(),
}))

const { assertTeacherOwnsTest } = vi.hoisted(() => ({
  assertTeacherOwnsTest: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'teacher-1', role: 'teacher' })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest,
}))

vi.mock('@/lib/server/test-ai-grading-runs', () => ({
  getTestAiGradingRunSummary,
  tickTestAiGradingRun,
}))

import { GET } from '@/app/api/teacher/tests/[id]/auto-grade-runs/[runId]/route'
import { POST } from '@/app/api/teacher/tests/[id]/auto-grade-runs/[runId]/tick/route'

describe('test auto-grade run routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertTeacherOwnsTest.mockResolvedValue({
      ok: true,
      test: {
        id: 'test-1',
        classroom_id: 'classroom-1',
        classrooms: { teacher_id: 'teacher-1' },
      },
    })
  })

  it('returns the current run summary', async () => {
    getTestAiGradingRunSummary.mockResolvedValue({
      id: 'run-1',
      test_id: 'test-1',
      status: 'running',
      model: 'gpt-5-nano',
      prompt_guideline_override: null,
      requested_count: 4,
      eligible_student_count: 4,
      queued_response_count: 4,
      processed_count: 1,
      completed_count: 1,
      skipped_unanswered_count: 1,
      skipped_already_graded_count: 0,
      failed_count: 0,
      pending_count: 3,
      next_retry_at: null,
      error_samples: [],
      started_at: '2026-04-20T12:00:00.000Z',
      completed_at: null,
      created_at: '2026-04-20T12:00:00.000Z',
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade-runs/run-1'),
      { params: Promise.resolve({ id: 'test-1', runId: 'run-1' }) },
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
    tickTestAiGradingRun.mockResolvedValue({
      claimed: true,
      run: {
        id: 'run-1',
        test_id: 'test-1',
        status: 'completed',
        model: 'gpt-5-nano',
        prompt_guideline_override: 'Use one strength and one next step.',
        requested_count: 4,
        eligible_student_count: 4,
        queued_response_count: 4,
        processed_count: 4,
        completed_count: 3,
        skipped_unanswered_count: 1,
        skipped_already_graded_count: 0,
        failed_count: 1,
        pending_count: 0,
        next_retry_at: null,
        error_samples: [{ student_id: 'student-4', code: 'server', message: 'AI grading service failed for this response. Try again.' }],
        started_at: '2026-04-20T12:00:00.000Z',
        completed_at: '2026-04-20T12:02:00.000Z',
        created_at: '2026-04-20T12:00:00.000Z',
      },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade-runs/run-1/tick', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'test-1', runId: 'run-1' }) },
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      claimed: true,
      run: expect.objectContaining({
        id: 'run-1',
        status: 'completed',
        completed_count: 3,
        failed_count: 1,
      }),
    })
    expect(tickTestAiGradingRun).toHaveBeenCalledWith({
      testId: 'test-1',
      runId: 'run-1',
    })
  })
})
