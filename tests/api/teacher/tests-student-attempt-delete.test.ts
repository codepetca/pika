import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE } from '@/app/api/teacher/tests/[id]/students/[studentId]/attempt/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

const mockSupabaseClient = { from: vi.fn() }

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

function makeDeleteQuery(rows: Array<{ id: string }>, calls: string[]) {
  return {
    delete: vi.fn(() => ({
      eq: vi.fn((column: string, value: string) => {
        calls.push(`${column}:${value}`)
        return {
          eq: vi.fn((nextColumn: string, nextValue: string) => {
            calls.push(`${nextColumn}:${nextValue}`)
            return {
              select: vi.fn(async () => ({ data: rows, error: null })),
            }
          }),
        }
      }),
    })),
  }
}

describe('DELETE /api/teacher/tests/[id]/students/[studentId]/attempt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    const deleteCalls: Record<string, string[]> = {}

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn(async () => ({ data: { student_id: 'student-1' }, error: null })),
          })),
        }
      }

      if (
        table === 'test_ai_grading_run_items' ||
        table === 'test_responses' ||
        table === 'test_focus_events' ||
        table === 'test_attempts'
      ) {
        deleteCalls[table] = []
        const rows =
          table === 'test_responses'
            ? [{ id: 'response-1' }, { id: 'response-2' }]
            : [{ id: `${table}-1` }]
        return makeDeleteQuery(rows, deleteCalls[table])
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
    expect(deleteCalls.test_attempts).toEqual(['test_id:test-1', 'student_id:student-1'])
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
