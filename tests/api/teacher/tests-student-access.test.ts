import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/student-access/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'

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

const mockSupabaseClient = { from: vi.fn(), rpc: vi.fn() }

describe('POST /api/teacher/tests/[id]/student-access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSupabaseClient.from.mockReset()
    mockSupabaseClient.rpc.mockReset()
  })

  it('requires state and selected students', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/student-access', {
        method: 'POST',
        body: JSON.stringify({ state: 'paused', student_ids: [] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe("state must be 'open' or 'closed'")
  })

  it('rejects draft tests', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Draft Test',
        status: 'draft',
        classroom_id: 'classroom-1',
        show_results: false,
        position: 0,
        points_possible: 1,
        include_in_final: true,
        created_by: 'teacher-1',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        classrooms: {
          id: 'classroom-1',
          teacher_id: 'teacher-1',
          archived_at: null,
        },
      },
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/student-access', {
        method: 'POST',
        body: JSON.stringify({ state: 'closed', student_ids: ['student-1'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot open or close students for a draft test')
  })

  it('upserts access for enrolled students and skips outsiders', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: { locked_count: 0, unlocked_count: 0, inserted_responses: 0 },
      error: null,
    })

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
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/student-access', {
        method: 'POST',
        body: JSON.stringify({ state: 'closed', student_ids: ['student-1', 'student-2'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({ updated_count: 1, skipped_count: 1, locked_count: 0, state: 'closed' })
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_test_student_access_atomic', {
      p_test_id: 'test-1',
      p_student_ids: ['student-1'],
      p_state: 'closed',
      p_updated_by: 'teacher-1',
    })
  })

  it('opens selected students through the atomic access RPC', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: { locked_count: 0, unlocked_count: 1, inserted_responses: 0 },
      error: null,
    })

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
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/student-access', {
        method: 'POST',
        body: JSON.stringify({ state: 'open', student_ids: ['student-1'] }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toMatchObject({ updated_count: 1, unlocked_count: 1, state: 'open' })
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_test_student_access_atomic', {
      p_test_id: 'test-1',
      p_student_ids: ['student-1'],
      p_state: 'open',
      p_updated_by: 'teacher-1',
    })
  })

  it('reports missing atomic access RPC migrations before mutating in route code', async () => {
    mockSupabaseClient.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find function update_test_student_access_atomic' },
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [{ student_id: 'student-existing' }, { student_id: 'student-new' }],
              error: null,
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/student-access', {
        method: 'POST',
        body: JSON.stringify({
          state: 'closed',
          student_ids: ['student-existing', 'student-new'],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Selected-student exam access requires migrations 060-062 to be applied')
    expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_test_student_access_atomic', {
      p_test_id: 'test-1',
      p_student_ids: ['student-existing', 'student-new'],
      p_state: 'closed',
      p_updated_by: 'teacher-1',
    })
  })
})
