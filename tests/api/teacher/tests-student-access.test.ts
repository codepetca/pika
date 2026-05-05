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

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/tests/[id]/student-access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    const upsertRows: Array<{ student_id: string; state: string }> = []

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
      if (table === 'test_student_availability') {
        return {
          upsert: vi.fn(async (rows: Array<{ student_id: string; state: string }>) => {
            upsertRows.push(...rows)
            return { error: null }
          }),
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(async () => ({ data: [], error: null })),
          })),
        }
      }
      if (table === 'test_attempts') {
        const selectQuery: any = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(async () => ({ data: [], error: null })),
        }
        return {
          select: vi.fn(() => selectQuery),
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
    expect(upsertRows).toEqual([
      expect.objectContaining({
        student_id: 'student-1',
        state: 'closed',
      }),
    ])
  })

  it('opens selected students by clearing teacher-close locks and finalized response rows', async () => {
    const updatePayloads: unknown[] = []
    const upsertRows: Array<{ student_id: string; state: string }> = []
    const deletedResponseStudentIds: string[][] = []

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
      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            in: vi.fn(async () => ({
              data: [{ student_id: 'student-1' }],
              error: null,
            })),
          })),
          update: vi.fn((payload: unknown) => {
            updatePayloads.push(payload)
            return {
              eq: vi.fn().mockReturnThis(),
              in: vi.fn(async () => ({ error: null })),
            }
          }),
        }
      }
      if (table === 'test_responses') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn(async (_column: string, studentIds: string[]) => {
              deletedResponseStudentIds.push(studentIds)
              return { error: null }
            }),
          })),
        }
      }
      if (table === 'test_student_availability') {
        return {
          upsert: vi.fn(async (rows: Array<{ student_id: string; state: string }>) => {
            upsertRows.push(...rows)
            return { error: null }
          }),
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
    expect(deletedResponseStudentIds).toEqual([['student-1']])
    expect(updatePayloads).toEqual([
      expect.objectContaining({
        closed_for_grading_at: null,
        closed_for_grading_by: null,
      }),
    ])
    expect(upsertRows).toEqual([
      expect.objectContaining({
        student_id: 'student-1',
        state: 'open',
      }),
    ])
  })
})
