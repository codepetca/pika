import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/surveys/[id]/questions/[qid]/route'

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

vi.mock('@/lib/server/surveys', () => ({
  assertTeacherOwnsSurvey: vi.fn(async () => ({
    ok: true,
    survey: { id: 'survey-1', title: 'Survey', classroom_id: 'classroom-1', classrooms: { archived_at: null } },
  })),
}))

describe('PATCH /api/teacher/surveys/[id]/questions/[qid]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates survey question content and markdown position', async () => {
    const updateSpy = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'question-1',
              question_type: 'multiple_choice',
              question_text: 'Updated prompt',
              options: ['A', 'B'],
              response_max_chars: 500,
              position: 3,
            },
            error: null,
          }),
        })),
      })),
    }))
    ;(mockSupabaseClient.from as any) = vi.fn(() => {
      const selectQuery: any = {
        eq: vi.fn(() => selectQuery),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'question-1',
            survey_id: 'survey-1',
            question_type: 'multiple_choice',
            question_text: 'Prompt',
            options: ['A', 'B'],
            response_max_chars: 500,
            position: 0,
          },
          error: null,
        }),
      }

      return {
        select: vi.fn(() => selectQuery),
        update: updateSpy,
      }
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/questions/question-1', {
        method: 'PATCH',
        body: JSON.stringify({
          question_text: ' Updated prompt ',
          options: [' A ', 'B'],
          position: 3,
        }),
      }),
      { params: Promise.resolve({ id: 'survey-1', qid: 'question-1' }) },
    )

    expect(response.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith({
      question_type: 'multiple_choice',
      question_text: 'Updated prompt',
      options: ['A', 'B'],
      response_max_chars: 500,
      position: 3,
    })
  })
})
