import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/students/attempts/bulk-delete/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

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

vi.mock('@/lib/server/tests', async () => {
  const actual = await vi.importActual<any>('@/lib/server/tests')
  return {
    ...actual,
    assertTeacherOwnsTest: vi.fn(async () => ({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        status: 'active',
        classroom_id: 'classroom-1',
        classrooms: { archived_at: null },
      },
    })),
  }
})

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/attempts/bulk-delete', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const params = { params: Promise.resolve({ id: 'test-1' }) }

function mockEnrollmentRows(studentIds: string[]) {
  ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
    if (table === 'classroom_enrollments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(async () => ({
            data: studentIds.map((student_id) => ({ student_id })),
            error: null,
          })),
        })),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })
}

describe('POST /api/teacher/tests/[id]/students/attempts/bulk-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc = vi.fn(async () => ({
      data: {
        requested_count: 2,
        deleted_student_count: 2,
        deleted_attempts: 2,
        deleted_responses: 4,
        deleted_focus_events: 3,
        deleted_ai_grading_items: 1,
      },
      error: null,
    }))
  })

  it('validates student_ids input', async () => {
    const missing = await POST(makeRequest({}), params)
    expect(missing.status).toBe(400)
    await expect(missing.json()).resolves.toEqual({ error: 'student_ids array is required' })

    const tooMany = await POST(
      makeRequest({ student_ids: Array.from({ length: 101 }, (_, index) => `student-${index}`) }),
      params
    )
    expect(tooMany.status).toBe(400)
    await expect(tooMany.json()).resolves.toEqual({
      error: 'Cannot delete test work for more than 100 students at once',
    })
  })

  it('requires every selected student to be enrolled before deleting anything', async () => {
    mockEnrollmentRows(['student-1'])

    const response = await POST(makeRequest({ student_ids: ['student-1', 'student-2'] }), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'One or more selected students are not enrolled in this classroom',
    })
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })

  it('deletes selected student test work through one atomic RPC', async () => {
    mockEnrollmentRows(['student-1', 'student-2'])

    const response = await POST(
      makeRequest({ student_ids: ['student-1', 'student-2', 'student-1', '  student-2  '] }),
      params
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledTimes(1)
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('delete_student_test_attempts_atomic', {
      p_test_id: 'test-1',
      p_student_ids: ['student-1', 'student-2'],
    })
    expect(data).toEqual({
      success: true,
      requested_count: 2,
      deleted_student_count: 2,
      deleted_attempts: 2,
      deleted_responses: 4,
      deleted_focus_events: 3,
      deleted_ai_grading_items: 1,
    })
  })

  it('returns migration guidance when the atomic bulk delete RPC is missing', async () => {
    mockEnrollmentRows(['student-1'])
    mockSupabaseClient.rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find function delete_student_test_attempts_atomic',
      },
    }))

    const response = await POST(makeRequest({ student_ids: ['student-1'] }), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Deleting selected student test work requires migration 072 to be applied',
    })
  })

  it('does not fall back to partial route-code deletion when the atomic RPC fails', async () => {
    mockEnrollmentRows(['student-1', 'student-2'])
    mockSupabaseClient.rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'transaction aborted' },
    }))

    const response = await POST(makeRequest({ student_ids: ['student-1', 'student-2'] }), params)

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to delete selected student test work',
    })
    expect(mockSupabaseClient.rpc).toHaveBeenCalledTimes(1)
    expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1)
  })

  it('rejects archived classrooms through the ownership check', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: 'Cannot modify archived classroom',
    })

    const response = await POST(makeRequest({ student_ids: ['student-1'] }), params)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Cannot modify archived classroom' })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
    expect(mockSupabaseClient.rpc).not.toHaveBeenCalled()
  })
})
