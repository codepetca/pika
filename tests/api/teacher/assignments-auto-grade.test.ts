import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { expectContentFreeDiagnostic, privateDiagnosticError } from '../../helpers/diagnostics'

afterEach(() => vi.restoreAllMocks())

const { createOrResumeAssignmentAiGradingRun } = vi.hoisted(() => ({
  createOrResumeAssignmentAiGradingRun: vi.fn(),
}))

const { assertTeacherCanMutateAssignment } = vi.hoisted(() => ({
  assertTeacherCanMutateAssignment: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/server/assignment-ai-grading-runs', () => ({
  createOrResumeAssignmentAiGradingRun,
}))

vi.mock('@/lib/server/repo-review', () => ({
  assertTeacherCanMutateAssignment,
}))

import { POST } from '@/app/api/teacher/assignments/[id]/auto-grade/route'
import { throwAssignmentAiUsageError } from '@/lib/server/assignment-ai-grading-usage'

const assignmentId = 'a0000000-0000-4000-8000-000000000001'
const studentId = 'b0000000-0000-4000-8000-000000000001'
const otherStudentId = 'b0000000-0000-4000-8000-000000000002'
const mockSupabaseClient = { from: vi.fn() }

function buildEnrollmentTable(opts?: { enrolledIds?: string[]; error?: unknown }) {
  const enrolledIds = opts?.enrolledIds ?? []
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        in: vi.fn().mockResolvedValue({
          data: enrolledIds.map((student_id) => ({ student_id })),
          error: opts?.error ?? null,
        }),
      })),
    })),
  }
}

function mockEnrollment(opts: { enrolledIds: string[]; error?: unknown }) {
  ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
    if (table === 'classroom_enrollments') {
      return buildEnrollmentTable({ enrolledIds: opts.enrolledIds, error: opts.error })
    }
    throw new Error(`Unexpected table: ${table}`)
  })
}

function requestFor(studentIds: string[]) {
  return new NextRequest(`http://localhost:3000/api/teacher/assignments/${assignmentId}/auto-grade`, {
    method: 'POST',
    body: JSON.stringify({ student_ids: studentIds }),
  })
}

function runSummary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    assignment_id: assignmentId,
    status: 'queued',
    model: 'gpt-5-nano',
    requested_count: 1,
    gradable_count: 1,
    processed_count: 0,
    completed_count: 0,
    skipped_missing_count: 0,
    skipped_empty_count: 0,
    failed_count: 0,
    pending_count: 1,
    next_retry_at: null,
    error_samples: [],
    started_at: null,
    completed_at: null,
    created_at: '2026-04-20T12:00:00.000Z',
    ...overrides,
  }
}

describe('POST /api/teacher/assignments/[id]/auto-grade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.GRADEX_ASSIGNMENT_GRADING_ENABLED
    delete process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED
    delete process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_TEACHER_IDS
    assertTeacherCanMutateAssignment.mockResolvedValue({
      id: assignmentId,
      classroom_id: 'classroom-1',
      title: 'Portfolio Site',
      created_by: 'teacher-1',
      classrooms: { teacher_id: 'teacher-1' },
    })
    createOrResumeAssignmentAiGradingRun.mockResolvedValue({
      kind: 'created',
      run: runSummary(),
    })
  })

  it.each([
    ['default gates', undefined, undefined],
    ['metered teacher', 'true', 'teacher-1'],
    ['unlisted teacher', 'true', 'teacher-2'],
  ])('always uses durable admission for a single student with %s', async (_label, master, cohort) => {
    if (master) process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED = master
    if (cohort) process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_TEACHER_IDS = cohort
    mockEnrollment({ enrolledIds: [studentId] })

    const response = await POST(requestFor([studentId]), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      mode: 'background',
      run: expect.objectContaining({ id: 'run-1', status: 'queued' }),
    })
    expect(createOrResumeAssignmentAiGradingRun).toHaveBeenCalledWith({
      assignmentId,
      teacherId: 'teacher-1',
      studentIds: [studentId],
    })
  })

  it.each([
    ['PGRST202', 'missing RPC private detail', 503, 'AI grading is temporarily unavailable'],
    ['23514', 'feature_usage_quota_exhausted', 429, 'AI grading limit reached'],
  ])('returns a content-free metering error for %s', async (code, message, status, expected) => {
    mockEnrollment({ enrolledIds: [studentId] })
    createOrResumeAssignmentAiGradingRun.mockImplementationOnce(() =>
      throwAssignmentAiUsageError({ code: String(code), message: String(message) }),
    )

    const response = await POST(requestFor([studentId]), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error: expected })
  })

  it.each([
    ['matching selection', 'resumed', 202],
    ['conflicting selection', 'conflict', 409],
  ] as const)('keeps persisted work durable after gate rollback for a %s', async (_label, kind, status) => {
    process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED = 'true'
    process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_TEACHER_IDS = 'teacher-2'
    createOrResumeAssignmentAiGradingRun.mockResolvedValueOnce({ kind, run: runSummary() })
    mockEnrollment({ enrolledIds: [studentId] })

    const response = await POST(requestFor([studentId]), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(status)
    expect(createOrResumeAssignmentAiGradingRun).toHaveBeenCalledOnce()
  })

  it('keeps enrollment lookup errors private and does not start grading', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockEnrollment({ enrolledIds: [studentId], error: privateDiagnosticError })

    const response = await POST(requestFor([studentId]), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to validate student enrollment' })
    expectContentFreeDiagnostic(consoleError.mock.calls, 'grading.assignment_enrollment')
    expect(createOrResumeAssignmentAiGradingRun).not.toHaveBeenCalled()
  })

  it('chunks enrollment validation filters for more than 50 selected students', async () => {
    const studentIds = Array.from(
      { length: 51 },
      (_, index) => `b0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    )
    const inCalls: string[][] = []
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn((_column: string, values: string[]) => {
                inCalls.push(values)
                return Promise.resolve({
                  data: values.map((enrolledStudentId) => ({ student_id: enrolledStudentId })),
                  error: null,
                })
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(requestFor(studentIds), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(202)
    expect(inCalls).toHaveLength(2)
    expect(inCalls[0]).toHaveLength(50)
    expect(inCalls[1]).toEqual(['b0000000-0000-4000-8000-000000000051'])
  })

  it('starts a resumable run for multiple students', async () => {
    mockEnrollment({ enrolledIds: [studentId, otherStudentId] })
    createOrResumeAssignmentAiGradingRun.mockResolvedValueOnce({
      kind: 'created',
      run: runSummary({ requested_count: 2, gradable_count: 2, pending_count: 2 }),
    })

    const response = await POST(requestFor([studentId, otherStudentId]), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(202)
    expect(createOrResumeAssignmentAiGradingRun).toHaveBeenCalledWith({
      assignmentId,
      teacherId: 'teacher-1',
      studentIds: [studentId, otherStudentId],
    })
  })

  it.each([
    ['single', [studentId]],
    ['batch', [studentId, otherStudentId]],
  ])('rejects a %s request when any student is not enrolled', async (_label, requestedStudentIds) => {
    mockEnrollment({ enrolledIds: [] })

    const response = await POST(requestFor(requestedStudentIds), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Student is not enrolled in this classroom',
    })
    expect(createOrResumeAssignmentAiGradingRun).not.toHaveBeenCalled()
  })

  it('returns the active run when another selection is already in progress', async () => {
    createOrResumeAssignmentAiGradingRun.mockResolvedValueOnce({
      kind: 'conflict',
      run: runSummary({ id: 'run-2', status: 'running' }),
    })
    mockEnrollment({ enrolledIds: [studentId, otherStudentId] })

    const response = await POST(requestFor([studentId, otherStudentId]), {
      params: Promise.resolve({ id: assignmentId }),
    })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'Another assignment AI grading run is already active',
      mode: 'background',
      run: expect.objectContaining({ id: 'run-2', status: 'running' }),
    })
  })
})
