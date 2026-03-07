import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PATCH } from '@/app/api/teacher/quizzes/[id]/route'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async (role: string) => {
    if (role === 'teacher') {
      return { id: 'teacher-1', email: 'teacher@example.com', role: 'teacher' }
    }
    throw new Error('Unauthorized')
  }),
}))

vi.mock('@/lib/server/quizzes', () => ({
  assertTeacherOwnsQuiz: vi.fn(),
  hasQuizOpened: (quiz: { status: string; opens_at: string | null }, now: Date = new Date()) => {
    if (quiz.status !== 'active') return false
    if (!quiz.opens_at) return true
    return new Date(quiz.opens_at).getTime() <= now.getTime()
  },
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

const mockSupabaseClient = {
  from: vi.fn(),
}

describe('PATCH /api/teacher/quizzes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows reverting scheduled active quiz to draft before it opens', async () => {
    const { assertTeacherOwnsQuiz } = await import('@/lib/server/quizzes')
    ;(assertTeacherOwnsQuiz as any).mockResolvedValueOnce({
      ok: true,
      quiz: {
        id: 'quiz-1',
        classroom_id: 'classroom-1',
        status: 'active',
        opens_at: '2099-03-01T14:00:00.000Z',
        title: 'Quiz',
        show_results: false,
        position: 0,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      },
    })

    let capturedUpdate: Record<string, unknown> | null = null
    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'quizzes') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            capturedUpdate = payload
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'quiz-1', ...payload },
                    error: null,
                  }),
                })),
              })),
            }
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draft' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quiz-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz.status).toBe('draft')
    expect(capturedUpdate).toMatchObject({ status: 'draft', opens_at: null })
  })

  it('rejects reverting an already-open active quiz to draft', async () => {
    const { assertTeacherOwnsQuiz } = await import('@/lib/server/quizzes')
    ;(assertTeacherOwnsQuiz as any).mockResolvedValueOnce({
      ok: true,
      quiz: {
        id: 'quiz-1',
        classroom_id: 'classroom-1',
        status: 'active',
        opens_at: '2020-03-01T14:00:00.000Z',
        title: 'Quiz',
        show_results: false,
        position: 0,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      },
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'draft' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quiz-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Cannot revert a quiz that has already opened to draft')
  })

  it('supports scheduling a draft quiz open time via opens_at', async () => {
    const { assertTeacherOwnsQuiz } = await import('@/lib/server/quizzes')
    ;(assertTeacherOwnsQuiz as any).mockResolvedValueOnce({
      ok: true,
      quiz: {
        id: 'quiz-1',
        classroom_id: 'classroom-1',
        status: 'draft',
        opens_at: null,
        title: 'Quiz',
        show_results: false,
        position: 0,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
      },
    })

    let capturedUpdate: Record<string, unknown> | null = null
    ;(mockSupabaseClient.from as any).mockImplementation((table: string) => {
      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 2 }),
          })),
        }
      }
      if (table === 'quizzes') {
        return {
          update: vi.fn((payload: Record<string, unknown>) => {
            capturedUpdate = payload
            return {
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'quiz-1', ...payload },
                    error: null,
                  }),
                })),
              })),
            }
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active', opens_at: '2099-03-01T14:00:00.000Z' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'quiz-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz.status).toBe('active')
    expect(capturedUpdate).toMatchObject({ status: 'active', opens_at: '2099-03-01T14:00:00.000Z' })
  })
})
