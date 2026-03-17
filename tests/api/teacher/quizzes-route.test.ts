import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/teacher/quizzes/route'
import { mockAuthenticationError } from '../setup'

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

vi.mock('@/lib/server/classrooms', () => ({
  assertTeacherOwnsClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1' },
  })),
  assertTeacherCanMutateClassroom: vi.fn(async () => ({
    ok: true,
    classroom: { id: 'classroom-1', teacher_id: 'teacher-1', archived_at: null },
  })),
}))

describe('teacher quizzes collection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )

    expect(response.status).toBe(401)
  })

  it('lists quizzes with draft overlays and stats', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          order: vi.fn(() => chain),
          then: vi.fn((resolve: any) =>
            resolve({
              data: [
                {
                  id: 'quiz-1',
                  classroom_id: 'classroom-1',
                  title: 'Stored title',
                  status: 'draft',
                  show_results: false,
                  position: 0,
                  created_at: '2026-03-01T00:00:00.000Z',
                },
              ],
              error: null,
            })
          ),
        }
        return chain
      }
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({ count: 2, error: null }),
          })),
        }
      }
      if (table === 'quiz_questions') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({ data: [{ quiz_id: 'quiz-1' }], error: null }),
          })),
        }
      }
      if (table === 'quiz_responses') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ quiz_id: 'quiz-1', student_id: 'student-1' }],
              error: null,
            }),
          })),
        }
      }
      if (table === 'assessment_drafts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  assessment_id: 'quiz-1',
                  content: {
                    title: 'Draft title',
                    show_results: true,
                    questions: [
                      {
                        id: '11111111-1111-4111-8111-111111111111',
                        question_text: 'Draft question',
                        options: ['A', 'B'],
                      },
                    ],
                  },
                },
              ],
              error: null,
            }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/quizzes?classroom_id=classroom-1')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quizzes[0].title).toBe('Draft title')
    expect(data.quizzes[0].stats).toEqual({
      total_students: 2,
      responded: 1,
      questions_count: 1,
    })
  })

  it('creates a new quiz at the next position', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'quizzes') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { position: 2 },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: 'quiz-1', ...payload },
                error: null,
              }),
            })),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/quizzes', {
        method: 'POST',
        body: JSON.stringify({ classroom_id: 'classroom-1', title: ' New Quiz ' }),
      })
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(data.quiz.position).toBe(3)
    expect(data.quiz.title).toBe('New Quiz')
  })
})
