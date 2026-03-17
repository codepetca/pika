import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/quizzes/[id]/questions/route'

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
    quiz: { id: 'quiz-1', title: 'Quiz', classroom_id: 'classroom-1', classrooms: { archived_at: null } },
  })),
}))

describe('POST /api/teacher/quizzes/[id]/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('validates question text and options', async () => {
    const missingText = await POST(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/questions', {
        method: 'POST',
        body: JSON.stringify({ question_text: '', options: ['A', 'B'] }),
      }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    expect(missingText.status).toBe(400)

    const badOptions = await POST(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/questions', {
        method: 'POST',
        body: JSON.stringify({ question_text: 'Prompt', options: ['Only one'] }),
      }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    expect(badOptions.status).toBe(400)
  })

  it('creates a question at the next position', async () => {
    const insertSpy = vi.fn((payload: Record<string, unknown>) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: { id: 'question-1', ...payload }, error: null }),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn().mockReturnThis(),
        order: vi.fn(() => ({
          limit: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: { position: 1 }, error: null }),
          })),
        })),
      })),
      insert: insertSpy,
    }))

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/questions', {
        method: 'POST',
        body: JSON.stringify({ question_text: ' Prompt ', options: ['A', 'B'] }),
      }),
      { params: Promise.resolve({ id: 'quiz-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(201)
    expect(insertSpy).toHaveBeenCalledWith({
      quiz_id: 'quiz-1',
      question_text: 'Prompt',
      options: ['A', 'B'],
      position: 2,
    })
    expect(data.question.id).toBe('question-1')
  })
})
