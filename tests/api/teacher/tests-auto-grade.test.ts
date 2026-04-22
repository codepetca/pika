import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { createOrResumeTestAiGradingRun } = vi.hoisted(() => ({
  createOrResumeTestAiGradingRun: vi.fn(),
}))

const { assertTeacherOwnsTest } = vi.hoisted(() => ({
  assertTeacherOwnsTest: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest,
}))

vi.mock('@/lib/server/test-ai-grading-runs', () => ({
  createOrResumeTestAiGradingRun,
}))

import { POST } from '@/app/api/teacher/tests/[id]/auto-grade/route'

describe('POST /api/teacher/tests/[id]/auto-grade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assertTeacherOwnsTest.mockResolvedValue({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        classroom_id: 'classroom-1',
        classrooms: { archived_at: null },
      },
    })
    createOrResumeTestAiGradingRun.mockResolvedValue({
      kind: 'created',
      run: {
        id: 'run-1',
        test_id: 'test-1',
        status: 'queued',
        model: 'gpt-5-nano',
        prompt_guideline_override: null,
        requested_count: 2,
        eligible_student_count: 2,
        queued_response_count: 2,
        processed_count: 0,
        completed_count: 0,
        skipped_unanswered_count: 0,
        skipped_already_graded_count: 0,
        failed_count: 0,
        pending_count: 2,
        next_retry_at: null,
        error_samples: [],
        started_at: null,
        completed_at: null,
        created_at: '2026-04-20T12:00:00.000Z',
      },
    })
  })

  it('returns 400 when student_ids is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({}),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
  })

  it('returns 400 when prompt_guideline is not a string', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
        prompt_guideline: 123,
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('prompt_guideline must be a string')
  })

  it('starts or resumes a background run when AI work remains', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2'],
        prompt_guideline: 'Use one strength and one next step.',
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(202)
    expect(data).toEqual({
      mode: 'background',
      run: expect.objectContaining({
        id: 'run-1',
        test_id: 'test-1',
        requested_count: 2,
      }),
    })
    expect(createOrResumeTestAiGradingRun).toHaveBeenCalledWith({
      testId: 'test-1',
      teacherId: 'teacher-1',
      studentIds: ['student-1', 'student-2'],
      promptGuidelineOverride: 'Use one strength and one next step.',
    })
  })

  it('returns the active run when another selection is already in progress', async () => {
    createOrResumeTestAiGradingRun.mockResolvedValueOnce({
      kind: 'conflict',
      run: {
        id: 'run-2',
        test_id: 'test-1',
        status: 'running',
        model: 'gpt-5-nano',
        prompt_guideline_override: null,
        requested_count: 3,
        eligible_student_count: 3,
        queued_response_count: 3,
        processed_count: 1,
        completed_count: 1,
        skipped_unanswered_count: 0,
        skipped_already_graded_count: 0,
        failed_count: 0,
        pending_count: 2,
        next_retry_at: null,
        error_samples: [],
        started_at: '2026-04-20T12:00:00.000Z',
        completed_at: null,
        created_at: '2026-04-20T12:00:00.000Z',
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data).toEqual({
      error: 'Another test AI grading run is already active',
      mode: 'background',
      run: expect.objectContaining({
        id: 'run-2',
        status: 'running',
      }),
    })
  })

  it('returns a no-op summary when no AI work remains after preflight', async () => {
    createOrResumeTestAiGradingRun.mockResolvedValueOnce({
      kind: 'noop',
      summary: {
        requested_count: 2,
        eligible_student_count: 2,
        queued_response_count: 0,
        skipped_unanswered_count: 1,
        skipped_already_graded_count: 1,
        failed_count: 0,
        message: 'No AI grading was needed for this selection.',
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2'],
      }),
    })

    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      mode: 'noop',
      summary: {
        requested_count: 2,
        eligible_student_count: 2,
        queued_response_count: 0,
        skipped_unanswered_count: 1,
        skipped_already_graded_count: 1,
        failed_count: 0,
        message: 'No AI grading was needed for this selection.',
      },
    })
  })
})
