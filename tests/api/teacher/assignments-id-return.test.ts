import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/assignments/[id]/return/route'
import { ApiError } from '@/lib/api-handler'

const { loadTeacherOwnedAssignment, mockSupabaseClient } = vi.hoisted(() => ({
  loadTeacherOwnedAssignment: vi.fn(),
  mockSupabaseClient: {
    rpc: vi.fn(),
  },
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

vi.mock('@/lib/server/assignments', () => ({
  loadTeacherOwnedAssignment,
}))

const student1 = '10000000-0000-4000-8000-000000000001'
const student2 = '10000000-0000-4000-8000-000000000002'
const student3 = '10000000-0000-4000-8000-000000000003'
const student4 = '10000000-0000-4000-8000-000000000004'

const successfulResult = {
  returned_count: 3,
  cleared_count: 3,
  updated_count: 2,
  created_count: 1,
  created_student_ids: [student4],
  returned_student_ids: [student1, student2, student4],
  blocked_count: 1,
  blocked_student_ids: [student3],
  already_returned_count: 0,
  already_returned_student_ids: [],
  missing_count: 0,
  missing_student_ids: [],
  not_enrolled_count: 0,
  not_enrolled_student_ids: [],
  mailbox_tracking_available: true,
}

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/teacher/assignments/a0000000-0000-4000-8000-000000000001/return', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/teacher/assignments/[id]/return', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadTeacherOwnedAssignment.mockResolvedValue({
      id: 'a0000000-0000-4000-8000-000000000001',
      classroom_id: 'classroom-1',
      classrooms: { teacher_id: 'teacher-1', archived_at: null },
    })
    mockSupabaseClient.rpc.mockResolvedValue({ data: successfulResult, error: null })
  })

  it('authenticates before parsing the request body', async () => {
    const { requireRole } = await import('@/lib/auth')
    const error = new Error('Not authenticated')
    error.name = 'AuthenticationError'
    vi.mocked(requireRole).mockRejectedValueOnce(error)

    const request = new NextRequest('http://localhost:3000/api/teacher/assignments/a0000000-0000-4000-8000-000000000001/return', {
      method: 'POST',
      body: '{',
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })

    expect(response.status).toBe(401)
    expect(loadTeacherOwnedAssignment).not.toHaveBeenCalled()
  })

  it('rejects a missing student list before authorization or database access', async () => {
    const response = await POST(makeRequest({}), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
    expect(loadTeacherOwnedAssignment).not.toHaveBeenCalled()
  })

  it('rejects a batch without string student ids', async () => {
    const response = await POST(makeRequest({ student_ids: [42] }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('rejects batches above 100 students', async () => {
    const response = await POST(makeRequest({
      student_ids: Array.from({ length: 101 }, (_, index) => `student-${index}`),
    }), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot return more than 100 students at once')
  })

  it('normalizes duplicate and non-string ids before the atomic call', async () => {
    const response = await POST(makeRequest({
      student_ids: [student1, student1, 42, student2],
    }), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
      'return_assignment_docs_with_feedback_atomic',
      {
        p_assignment_id: 'a0000000-0000-4000-8000-000000000001',
        p_student_ids: [student1, student2],
        p_teacher_id: 'teacher-1',
        p_now: expect.any(String),
      },
    )
  })

  it('returns the complete atomic result unchanged', async () => {
    const response = await POST(makeRequest({
      student_ids: [student1, student2, student3, student4],
    }), { params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual(successfulResult)
    expect(loadTeacherOwnedAssignment).toHaveBeenCalledWith({
      supabase: mockSupabaseClient,
      assignmentId: 'a0000000-0000-4000-8000-000000000001',
      teacherId: 'teacher-1',
    })
  })

  it('rejects mutation of an archived classroom before the RPC', async () => {
    loadTeacherOwnedAssignment.mockRejectedValueOnce(
      new ApiError(403, 'Classroom is archived'),
    )

    const response = await POST(makeRequest({ student_ids: [student1] }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.error).toBe('Classroom is archived')
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('returns 500 without exposing a partial result when the RPC fails', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({
      data: null,
      error: { message: 'transaction rolled back' },
    })

    const response = await POST(makeRequest({ student_ids: [student1] }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to return docs')
  })

  it('returns a retryable conflict when a missing document is created concurrently', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({
      data: null,
      error: { code: '40001', message: 'Assignment document changed; retry return' },
    })

    const response = await POST(makeRequest({ student_ids: [student1] }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(409)
    expect(data.error).toBe('Assignment document changed; retry return')
  })

  it('rejects an invalid database response as a server contract failure', async () => {
    mockSupabaseClient.rpc.mockResolvedValue({ data: { returned_count: 1 }, error: null })

    const response = await POST(makeRequest({ student_ids: [student1] }), {
      params: Promise.resolve({ id: 'a0000000-0000-4000-8000-000000000001' }),
    })
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Invalid assignment return result')
  })
})
