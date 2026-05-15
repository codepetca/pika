import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/surveys/[id]/questions/route'

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

describe('POST /api/teacher/surveys/[id]/questions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a question at an explicit markdown position', async () => {
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
            maybeSingle: vi.fn().mockResolvedValue({ data: { position: 7 }, error: null }),
          })),
        })),
      })),
      insert: insertSpy,
    }))

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/surveys/survey-1/questions', {
        method: 'POST',
        body: JSON.stringify({
          question_type: 'link',
          question_text: 'Share your game',
          options: [],
          response_max_chars: 2048,
          position: 2,
        }),
      }),
      { params: Promise.resolve({ id: 'survey-1' }) },
    )

    expect(response.status).toBe(201)
    expect(insertSpy).toHaveBeenCalledWith({
      survey_id: 'survey-1',
      question_type: 'link',
      question_text: 'Share your game',
      options: [],
      response_max_chars: 2048,
      position: 2,
    })
  })
})
