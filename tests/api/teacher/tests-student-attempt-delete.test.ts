import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from '@/app/api/teacher/tests/[id]/students/[studentId]/attempt/route'
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

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/attempt', {
    method: 'DELETE',
  })
}

function makeContext(studentId = 'student-1') {
  return { params: Promise.resolve({ id: 'test-1', studentId }) }
}

describe('DELETE /api/teacher/tests/[id]/students/[studentId]/attempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.rpc = vi.fn()
  })

  it('requires the student to be enrolled in the test classroom', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await DELETE(makeRequest(), makeContext())
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Student is not enrolled in this classroom')
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith('teacher-1', 'test-1', { checkArchived: true })
  })

  it('deletes one student attempt data without changing access overrides', async () => {
    mockSupabaseClient.rpc = vi.fn(async () => ({
      data: {
        deleted_attempts: 1,
        deleted_responses: 2,
        deleted_focus_events: 1,
        deleted_ai_grading_items: 1,
      },
      error: null,
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: { student_id: 'student-1' }, error: null })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await DELETE(makeRequest(), makeContext())
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      deleted_attempts: 1,
      deleted_responses: 2,
      deleted_focus_events: 1,
      deleted_ai_grading_items: 1,
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalledWith('test_student_availability')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('delete_student_test_attempt_atomic', {
      p_test_id: 'test-1',
      p_student_id: 'student-1',
    })
  })

  it('returns migration guidance when the atomic delete RPC is missing', async () => {
    mockSupabaseClient.rpc = vi.fn(async () => ({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find function delete_student_test_attempt_atomic',
      },
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: { student_id: 'student-1' }, error: null })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await DELETE(makeRequest(), makeContext())
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Deleting student test work requires migration 063 to be applied')
  })

  it('rejects archived classrooms through the ownership check', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: false,
      status: 400,
      error: 'Cannot modify archived classroom',
    })

    const response = await DELETE(makeRequest(), makeContext())
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot modify archived classroom')
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})
