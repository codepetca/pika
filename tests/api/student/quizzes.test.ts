import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/student/quizzes/route'
import { mockAuthenticationError } from '../setup'

const mockSupabaseClient = { from: vi.fn() }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'student-1',
    email: 'student1@example.com',
    role: 'student',
  })),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', archived_at: null },
  })),
}))

describe('GET /api/student/quizzes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes?classroom_id=classroom-1')
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns 400 when classroom_id is missing', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/student/quizzes'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'classroom_id is required' })
  })

  it('returns access errors from the classroom helper', async () => {
    const { assertStudentCanAccessClassroom } = await import('@/lib/server/classrooms')
    ;(assertStudentCanAccessClassroom as any).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Forbidden',
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes?classroom_id=classroom-1')
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('returns 500 when the active quiz query fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn(() => {
      let statusFilter: string | null = null
      const chain: any = {
        select: vi.fn(() => chain),
        eq: vi.fn((column: string, value: string) => {
          if (column === 'status') statusFilter = value
          return chain
        }),
        order: vi.fn(async () =>
          statusFilter === 'active'
            ? { data: null, error: { message: 'boom' } }
            : { data: [], error: null }
        ),
      }
      return chain
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes?classroom_id=classroom-1')
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch quizzes' })
  })

  it('returns visible active quizzes plus responded closed quizzes with student status', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        let statusFilter: string | null = null
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn((column: string, value: string) => {
            if (column === 'status') statusFilter = value
            return chain
          }),
          order: vi.fn(async () => {
            if (statusFilter === 'active') {
              return {
                data: [
                  {
                    id: 'quiz-active-visible',
                    classroom_id: 'classroom-1',
                    title: 'Visible Quiz',
                    status: 'active',
                    show_results: false,
                    opens_at: null,
                    position: 0,
                  },
                  {
                    id: 'quiz-active-hidden',
                    classroom_id: 'classroom-1',
                    title: 'Hidden Quiz',
                    status: 'active',
                    show_results: false,
                    opens_at: '2099-01-01T00:00:00.000Z',
                    position: 1,
                  },
                ],
                error: null,
              }
            }

            return {
              data: [
                {
                  id: 'quiz-closed-responded',
                  classroom_id: 'classroom-1',
                  title: 'Closed Quiz',
                  status: 'closed',
                  show_results: true,
                  opens_at: null,
                  position: 2,
                },
                {
                  id: 'quiz-closed-unanswered',
                  classroom_id: 'classroom-1',
                  title: 'Skipped Closed Quiz',
                  status: 'closed',
                  show_results: true,
                  opens_at: null,
                  position: 3,
                },
              ],
              error: null,
            }
          }),
        }
        return chain
      }

      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({
                data: [{ quiz_id: 'quiz-closed-responded' }],
                error: null,
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/student/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes).toEqual([
      expect.objectContaining({
        id: 'quiz-active-visible',
        assessment_type: 'quiz',
        student_status: 'not_started',
      }),
      expect.objectContaining({
        id: 'quiz-closed-responded',
        assessment_type: 'quiz',
        student_status: 'can_view_results',
      }),
    ])
  })
})
