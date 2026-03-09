import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/clear-open-grades/route'

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

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: {
      id: 'test-1',
      title: 'Unit Test',
      classroom_id: 'classroom-1',
      classrooms: { archived_at: null },
    },
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/tests/[id]/clear-open-grades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when student_ids is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/clear-open-grades', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
  })

  it('clears open-response grade fields and reports counts', async () => {
    const updatedPayloads: Array<Record<string, unknown>> = []

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [{ id: 'open-q1' }, { id: 'open-q2' }],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
        }
      }

      if (table === 'test_responses') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            updatedPayloads.push(payload)
            return {
              eq: vi.fn(() => ({
                in: vi.fn(() => ({
                  in: vi.fn(() => ({
                    select: vi.fn(async () => ({
                      data: [
                        { id: 'r1', student_id: 'student-1' },
                        { id: 'r2', student_id: 'student-1' },
                        { id: 'r3', student_id: 'student-2' },
                      ],
                      error: null,
                    })),
                  })),
                })),
              })),
            }
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/clear-open-grades', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1', 'student-2', 'student-3'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updatedPayloads).toEqual([
      expect.objectContaining({
        score: null,
        feedback: null,
        graded_at: null,
        graded_by: null,
        ai_grading_basis: null,
        ai_reference_answers: null,
        ai_model: null,
      }),
    ])
    expect(data).toEqual({
      cleared_students: 2,
      skipped_students: 1,
      cleared_responses: 3,
    })
  })

  it('returns skipped counts when there are no open-response questions', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table !== 'test_questions') {
        throw new Error(`Unexpected table: ${table}`)
      }

      const query = {
        eq: vi.fn().mockReturnThis(),
      } as any
      query.eq.mockImplementationOnce(() => query)
      query.eq.mockImplementationOnce(async () => ({
        data: [],
        error: null,
      }))

      return {
        select: vi.fn(() => query),
      }
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/clear-open-grades', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1', 'student-2'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({
      cleared_students: 0,
      skipped_students: 2,
      cleared_responses: 0,
    })
  })
})
