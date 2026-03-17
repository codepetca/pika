import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/quizzes/[id]/results/route'

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

vi.mock('@/lib/server/quizzes', () => ({
  assertTeacherOwnsQuiz: vi.fn(async () => ({
    ok: true,
    quiz: {
      id: 'quiz-1',
      classroom_id: 'classroom-1',
      title: 'Quiz One',
      status: 'active',
      show_results: false,
      position: 0,
      created_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      classrooms: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
    },
  })),
}))

describe('GET /api/teacher/quizzes/[id]/results', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 500 when question loading fails', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/results'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )

    expect(response.status).toBe(500)
  })

  it('returns aggregated results, responders, and stats', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'q1', question_text: '2 + 2?', options: ['4', '5'], position: 0 }],
              error: null,
            }),
          })),
        }
      }
      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1', question_id: 'q1', selected_option: 0 },
                { student_id: 'student-2', question_id: 'q1', selected_option: 1 },
              ],
              error: null,
            }),
          })),
        }
      }
      if (table === 'users') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                { id: 'student-1', email: 'a@example.com' },
                { id: 'student-2', email: 'b@example.com' },
              ],
              error: null,
            }),
          })),
        }
      }
      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                { user_id: 'student-1', first_name: 'Alice', last_name: 'Brown' },
                { user_id: 'student-2', first_name: 'Zed', last_name: 'Young' },
              ],
              error: null,
            }),
          })),
        }
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 3, error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/results'),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.results[0].counts).toEqual([1, 1])
    expect(data.responders).toHaveLength(2)
    expect(data.responders[0].name).toBe('Alice Brown')
    expect(data.stats).toEqual({ total_students: 3, responded: 2 })
  })
})
