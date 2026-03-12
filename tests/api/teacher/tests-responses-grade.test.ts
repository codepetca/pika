import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/tests/[id]/responses/[responseId]/route'

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

describe('PATCH /api/teacher/tests/[id]/responses/[responseId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockResponseRow(
    questionType: 'open_response' | 'multiple_choice' = 'open_response',
    points = 5
  ) {
    return {
      id: 'response-1',
      test_id: 'test-1',
      question_id: 'question-1',
      score: null,
      feedback: null,
      response_text: questionType === 'open_response' ? 'Water moves to balance concentration.' : null,
      test_questions: {
        id: 'question-1',
        question_type: questionType,
        points,
      },
    }
  }

  function setupSupabase(
    updateSpy: ReturnType<typeof vi.fn>,
    options: { questionType?: 'open_response' | 'multiple_choice'; points?: number } = {}
  ) {
    const { questionType = 'open_response', points = 5 } = options
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table !== 'test_responses') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: mockResponseRow(questionType, points),
            error: null,
          }),
        })),
        update: updateSpy,
      }
    })
  }

  it('persists AI grading metadata when saving a suggested grade', async () => {
    const updateSpy = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'response-1', ...payload },
              error: null,
            }),
          })),
        })),
      })),
    }))

    setupSupabase(updateSpy)

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/responses/response-1', {
        method: 'PATCH',
        body: JSON.stringify({
          score: 4,
          feedback: 'Good work overall.',
          ai_grading_basis: 'generated_reference',
          ai_reference_answers: ['Reference one', 'Reference two'],
          ai_model: 'gpt-5-nano',
        }),
      }),
      { params: Promise.resolve({ id: 'test-1', responseId: 'response-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 4,
        feedback: 'Good work overall.',
        ai_grading_basis: 'generated_reference',
        ai_reference_answers: ['Reference one', 'Reference two'],
        ai_model: 'gpt-5-nano',
      })
    )
    expect(data.response.ai_grading_basis).toBe('generated_reference')
  })

  it('allows saving a score without feedback', async () => {
    const updateSpy = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'response-1', ...payload },
              error: null,
            }),
          })),
        })),
      })),
    }))
    setupSupabase(updateSpy)

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/responses/response-1', {
        method: 'PATCH',
        body: JSON.stringify({
          score: 3.5,
          feedback: '   ',
        }),
      }),
      { params: Promise.resolve({ id: 'test-1', responseId: 'response-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 3.5,
        feedback: null,
      })
    )
    expect(data.response.feedback).toBeNull()
  })

  it('clears score, feedback, and grading metadata', async () => {
    const updateSpy = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'response-1', ...payload },
              error: null,
            }),
          })),
        })),
      })),
    }))
    setupSupabase(updateSpy)

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/responses/response-1', {
        method: 'PATCH',
        body: JSON.stringify({
          clear_grade: true,
        }),
      }),
      { params: Promise.resolve({ id: 'test-1', responseId: 'response-1' }) }
    )

    expect(response.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        score: null,
        feedback: null,
        graded_at: null,
        graded_by: null,
        ai_grading_basis: null,
        ai_reference_answers: null,
        ai_model: null,
      })
    )
  })

  it('allows manual score overrides for multiple-choice responses', async () => {
    const updateSpy = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { id: 'response-1', ...payload },
              error: null,
            }),
          })),
        })),
      })),
    }))
    setupSupabase(updateSpy, { questionType: 'multiple_choice', points: 2 })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/responses/response-1', {
        method: 'PATCH',
        body: JSON.stringify({
          score: 1.5,
        }),
      }),
      { params: Promise.resolve({ id: 'test-1', responseId: 'response-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        score: 1.5,
        feedback: null,
      })
    )
    expect(data.response.score).toBe(1.5)
  })
})
