import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/auto-grade/route'

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

const suggestTestOpenResponseGrade = vi.fn()
const generateTestOpenResponseReferences = vi.fn()
const getTestOpenResponseGradingModel = vi.fn(() => 'gpt-5-nano')
const normalizeTestOpenResponseReferenceAnswers = vi.fn((raw: unknown) => {
  if (!Array.isArray(raw)) throw new Error('Invalid')
  return raw
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value.length > 0)
})
const buildTestOpenResponseReferenceCacheKey = vi.fn((input: {
  questionText: string
  maxPoints: number
  model: string
}) => `${input.model}|${input.maxPoints}|${input.questionText}`)
vi.mock('@/lib/ai-test-grading', () => ({
  buildTestOpenResponseReferenceCacheKey: (...args: any[]) => buildTestOpenResponseReferenceCacheKey(...args),
  generateTestOpenResponseReferences: (...args: any[]) => generateTestOpenResponseReferences(...args),
  getTestOpenResponseGradingModel: (...args: any[]) => getTestOpenResponseGradingModel(...args),
  normalizeTestOpenResponseReferenceAnswers: (...args: any[]) => normalizeTestOpenResponseReferenceAnswers(...args),
  suggestTestOpenResponseGrade: (...args: any[]) => suggestTestOpenResponseGrade(...args),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('POST /api/teacher/tests/[id]/auto-grade', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when student_ids is missing', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({}),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('student_ids array is required')
  })

  it('auto-grades eligible open responses and skips non-eligible students', async () => {
    const updatedRows: Array<Record<string, unknown>> = []
    const cacheUpdates: Array<Record<string, unknown>> = []

    generateTestOpenResponseReferences.mockResolvedValue({
      reference_answers: ['Reference answer'],
      model: 'gpt-5-nano',
    })
    suggestTestOpenResponseGrade.mockResolvedValue({
      score: 4.5,
      feedback: 'Good explanation',
      grading_basis: 'generated_reference',
      reference_answers: ['Reference answer'],
      model: 'gpt-5-nano',
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [{ id: 'q-open-1' }],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
          update: vi.fn((payload: Record<string, unknown>) => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockImplementation(async () => {
                cacheUpdates.push(payload)
                return { error: null }
              }),
            })),
          })),
        }
      }

      if (table === 'test_responses') {
        const query = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
        } as any
        query.in.mockImplementationOnce(() => query)
        query.in.mockImplementationOnce(async () => ({
          data: [
              {
                id: 'response-1',
                question_id: 'q-open-1',
                student_id: 'student-1',
                response_text: 'Arrays are ordered.',
                test_questions: {
                  question_text: 'Explain arrays vs objects.',
                  points: 5,
                  answer_key: null,
                  ai_reference_cache_key: null,
                  ai_reference_cache_answers: null,
                  ai_reference_cache_model: null,
                },
              },
              {
                id: 'response-2',
                question_id: 'q-open-1',
                student_id: 'student-2',
                response_text: '   ',
                test_questions: {
                  question_text: 'Explain arrays vs objects.',
                  points: 5,
                  answer_key: null,
                  ai_reference_cache_key: null,
                  ai_reference_cache_answers: null,
                  ai_reference_cache_model: null,
                },
              },
          ],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
          update: vi.fn((payload: { score: number; feedback: string; graded_by: string }) => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockImplementation(async () => {
                updatedRows.push(payload)
                return { error: null }
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1', 'student-2'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.graded_students).toBe(1)
    expect(data.skipped_students).toBe(1)
    expect(data.eligible_students).toBe(1)
    expect(data.graded_responses).toBe(1)
    expect(generateTestOpenResponseReferences).toHaveBeenCalledTimes(1)
    expect(cacheUpdates).toHaveLength(1)
    expect(suggestTestOpenResponseGrade).toHaveBeenCalledTimes(1)
    expect(suggestTestOpenResponseGrade).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceAnswers: ['Reference answer'],
      })
    )
    expect(updatedRows).toEqual([
      expect.objectContaining({
        score: 4.5,
        feedback: 'Good explanation',
        graded_by: 'teacher-1',
        ai_grading_basis: 'generated_reference',
        ai_reference_answers: ['Reference answer'],
        ai_model: 'gpt-5-nano',
      }),
    ])
  })

  it('reuses cached references when question version key matches', async () => {
    const updatedRows: Array<Record<string, unknown>> = []
    const cacheUpdates: Array<Record<string, unknown>> = []
    const cachedReferences = ['Cached reference answer 1', 'Cached reference answer 2']

    suggestTestOpenResponseGrade.mockResolvedValue({
      score: 3.75,
      feedback: 'Solid explanation with one missing detail.',
      grading_basis: 'generated_reference',
      reference_answers: cachedReferences,
      model: 'gpt-5-nano',
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [{ id: 'q-open-1' }],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
          update: vi.fn((payload: Record<string, unknown>) => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockImplementation(async () => {
                cacheUpdates.push(payload)
                return { error: null }
              }),
            })),
          })),
        }
      }

      if (table === 'test_responses') {
        const query = {
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
        } as any
        query.in.mockImplementationOnce(() => query)
        query.in.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'response-1',
              question_id: 'q-open-1',
              student_id: 'student-1',
              response_text: 'Arrays preserve insertion order for index-like keys.',
              test_questions: {
                question_text: 'Explain arrays vs objects.',
                points: 5,
                answer_key: null,
                ai_reference_cache_key: 'gpt-5-nano|5|Explain arrays vs objects.',
                ai_reference_cache_answers: cachedReferences,
                ai_reference_cache_model: 'gpt-5-nano',
              },
            },
          ],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
          update: vi.fn((payload: { score: number; feedback: string; graded_by: string }) => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockImplementation(async () => {
                updatedRows.push(payload)
                return { error: null }
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({ student_ids: ['student-1'] }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.graded_students).toBe(1)
    expect(data.graded_responses).toBe(1)
    expect(generateTestOpenResponseReferences).not.toHaveBeenCalled()
    expect(cacheUpdates).toHaveLength(0)
    expect(suggestTestOpenResponseGrade).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceAnswers: cachedReferences,
      })
    )
    expect(updatedRows).toHaveLength(1)
  })
})
