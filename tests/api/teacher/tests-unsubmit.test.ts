import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/unsubmit/route'

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }
let testStatus: 'draft' | 'active' | 'closed' = 'active'

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
        status: testStatus,
        classroom_id: 'classroom-1',
        classrooms: { archived_at: null },
      },
    })),
  }
})

describe('POST /api/teacher/tests/[id]/unsubmit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testStatus = 'active'
  })

  it('requires selected students', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/unsubmit', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
  })

  it('rejects draft tests', async () => {
    testStatus = 'draft'
    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/unsubmit', {
        method: 'POST',
        body: JSON.stringify({ student_ids: ['student-1'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot unsubmit students for a draft test')
  })

  it('marks selected attempts unsubmitted and clears finalized responses without opening access', async () => {
    const historyRows: Array<Record<string, unknown>> = []
    mockSupabaseClient.rpc = vi.fn(async () => ({
      data: {
        unsubmitted_count: 1,
        attempts: [
          {
            id: 'attempt-1',
            student_id: 'student-1',
            responses: {
              'q-1': { question_type: 'multiple_choice', selected_option: 0 },
            },
          },
        ],
      },
      error: null,
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [{ student_id: 'student-1' }],
              error: null,
            })),
          })),
        }
      }

      if (table === 'test_attempt_history') {
        return {
          insert: vi.fn((row: Record<string, unknown>) => {
            historyRows.push(row)
            return {
              select: vi.fn(() => ({
                single: vi.fn(async () => ({ data: { id: 'history-1' }, error: null })),
              })),
            }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/unsubmit', {
        method: 'POST',
        body: JSON.stringify({ student_ids: ['student-1', 'student-2'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({
      unsubmitted_count: 1,
      skipped_count: 1,
      skipped_enrollment_count: 1,
    })
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('unsubmit_test_attempts_atomic', {
      p_test_id: 'test-1',
      p_student_ids: ['student-1'],
      p_updated_by: 'teacher-1',
    })
    expect(historyRows).toEqual([
      expect.objectContaining({ test_attempt_id: 'attempt-1', trigger: 'teacher_unsubmit' }),
    ])
  })

  it('returns migration guidance when the atomic unsubmit RPC is missing', async () => {
    mockSupabaseClient.rpc = vi.fn(async () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find function unsubmit_test_attempts_atomic' },
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [{ student_id: 'student-1' }],
              error: null,
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/unsubmit', {
        method: 'POST',
        body: JSON.stringify({ student_ids: ['student-1'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Unsubmitting test attempts requires migrations 061-063 to be applied')
  })
})
