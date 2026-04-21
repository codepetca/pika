import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/responses/[responseId]/ai-suggest/route'

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

const getTestOpenResponseGradingModel = vi.fn(() => 'gpt-5-nano')
const prepareTestOpenResponseGradingContext = vi.fn()
const suggestTestOpenResponseGradeWithContext = vi.fn()
const resolveReusableTestOpenResponseReferenceAnswers = vi.fn(() => ({
  expectedCacheKey: 'cache-key',
  cacheHit: true,
  referenceAnswers: ['Cached reference answer'],
}))
vi.mock('@/lib/ai-test-grading', () => ({
  getTestOpenResponseGradingModel: () => getTestOpenResponseGradingModel(),
  prepareTestOpenResponseGradingContext: (...args: any[]) =>
    prepareTestOpenResponseGradingContext(...args),
  suggestTestOpenResponseGradeWithContext: (...args: any[]) =>
    suggestTestOpenResponseGradeWithContext(...args),
  resolveReusableTestOpenResponseReferenceAnswers: (...args: any[]) =>
    resolveReusableTestOpenResponseReferenceAnswers(...args),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/tests/[id]/responses/[responseId]/ai-suggest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns suggestion with grading metadata and uses answer_key context', async () => {
    prepareTestOpenResponseGradingContext.mockResolvedValue({
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: [],
      reference_answers_source: 'teacher_key',
    })
    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 3.75,
      feedback: 'Good foundation. Add membrane specifics.',
      grading_basis: 'teacher_key',
      reference_answers: [],
      model: 'gpt-5-nano',
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table !== 'test_responses') {
        throw new Error(`Unexpected table: ${table}`)
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'response-1',
              test_id: 'test-1',
              question_id: 'question-1',
              response_text: 'Water moves to balance concentration.',
              test_questions: {
                id: 'question-1',
                question_type: 'open_response',
                question_text: 'Explain osmosis.',
                points: 5,
                response_monospace: true,
                answer_key:
                  'Water moves across a semi-permeable membrane from low solute to high solute concentration.',
                sample_solution:
                  'public String explainOsmosis() {\n  return "Water moves across a semipermeable membrane.";\n}',
                ai_reference_cache_key: 'cache-key',
                ai_reference_cache_answers: ['Cached reference answer'],
                ai_reference_cache_model: 'gpt-5-nano',
              },
            },
            error: null,
          }),
        })),
      }
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/responses/response-1/ai-suggest', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'test-1', responseId: 'response-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(prepareTestOpenResponseGradingContext).toHaveBeenCalledWith(
      expect.objectContaining({
        answerKey: expect.stringContaining('semi-permeable membrane'),
        sampleSolution: expect.stringContaining('explainOsmosis'),
        responseMonospace: true,
        promptProfile: 'manual',
      })
    )
    expect(suggestTestOpenResponseGradeWithContext).toHaveBeenCalledTimes(1)
    expect(data.suggestion).toEqual(
      expect.objectContaining({
        grading_basis: 'teacher_key',
        model: 'gpt-5-nano',
      })
    )
  })
})
