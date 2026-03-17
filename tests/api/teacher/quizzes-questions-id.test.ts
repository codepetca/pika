import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, PATCH } from '@/app/api/teacher/quizzes/[id]/questions/[qid]/route'

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

describe('teacher quiz question detail route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when a patch provides no updates', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn(() => {
      const selectQuery: any = {
        eq: vi.fn(() => selectQuery),
        single: vi.fn().mockResolvedValue({
          data: { id: 'question-1', quiz_id: 'quiz-1', question_text: 'Prompt', options: ['A', 'B'] },
          error: null,
        }),
      }

      return {
        select: vi.fn(() => selectQuery),
      }
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/questions/question-1', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'quiz-1', qid: 'question-1' }) }
    )

    expect(response.status).toBe(400)
  })

  it('updates a question', async () => {
    const updateSpy = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: { id: 'question-1', question_text: 'Updated', options: ['A', 'B'] },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => {
      const selectQuery: any = {
        eq: vi.fn(() => selectQuery),
        single: vi.fn().mockResolvedValue({
          data: { id: 'question-1', quiz_id: 'quiz-1', question_text: 'Prompt', options: ['A', 'B'] },
          error: null,
        }),
      }

      return {
        select: vi.fn(() => selectQuery),
        update: updateSpy,
      }
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/questions/question-1', {
        method: 'PATCH',
        body: JSON.stringify({ question_text: ' Updated ' }),
      }),
      { params: Promise.resolve({ id: 'quiz-1', qid: 'question-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.question.question_text).toBe('Updated')
  })

  it('deletes a question after confirming quiz ownership', async () => {
    const deleteSpy = vi.fn(() => {
      const deleteQuery: any = {
        eq: vi.fn().mockResolvedValue({ error: null }),
      }
      return deleteQuery
    })
    ;(mockSupabaseClient.from as any) = vi.fn(() => {
      const selectQuery: any = {
        eq: vi.fn(() => selectQuery),
        single: vi.fn().mockResolvedValue({
          data: { id: 'question-1' },
          error: null,
        }),
      }

      return {
        select: vi.fn(() => selectQuery),
        delete: deleteSpy,
      }
    })

    const response = await DELETE(
      new NextRequest('http://localhost:3000/api/teacher/quizzes/quiz-1/questions/question-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'quiz-1', qid: 'question-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ success: true })
  })
})
