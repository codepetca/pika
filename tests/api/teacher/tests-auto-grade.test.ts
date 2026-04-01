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
const prepareTestOpenResponseGradingContext = vi.fn()
const suggestTestOpenResponseGradeWithContext = vi.fn()
const suggestTestOpenResponseGradesBatch = vi.fn()
const getTestOpenResponseGradingModel = vi.fn(() => 'gpt-5-nano')
vi.mock('@/lib/ai-test-grading', () => ({
  suggestTestOpenResponseGrade: (...args: any[]) => suggestTestOpenResponseGrade(...args),
  prepareTestOpenResponseGradingContext: (...args: any[]) =>
    prepareTestOpenResponseGradingContext(...args),
  suggestTestOpenResponseGradeWithContext: (...args: any[]) =>
    suggestTestOpenResponseGradeWithContext(...args),
  suggestTestOpenResponseGradesBatch: (...args: any[]) => suggestTestOpenResponseGradesBatch(...args),
  getTestOpenResponseGradingModel: () => getTestOpenResponseGradingModel(),
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
    const aiUpdates: Array<{ score: number; feedback: string; graded_by: string }> = []
    const unansweredUpdates: Array<{
      payload: { score: number; feedback: string; graded_by: string }
      ids: string[]
    }> = []

    prepareTestOpenResponseGradingContext.mockResolvedValue({
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: [],
    })
    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 4.5,
      feedback: 'Good explanation',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: [],
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = {
          eq: vi.fn().mockReturnThis(),
        } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'q-open-1',
              question_text: 'Explain arrays vs objects.',
              points: 5,
              response_monospace: true,
              answer_key: 'Arrays are ordered lists; objects map keys to values.',
              sample_solution: 'String[] names = {"Ada", "Grace"};',
            },
          ],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
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
              student_id: 'student-1',
              question_id: 'q-open-1',
              response_text: 'Arrays are ordered.',
            },
            {
              id: 'response-2',
              student_id: 'student-2',
              question_id: 'q-open-1',
              response_text: '   ',
            },
          ],
          error: null,
        }))

        return {
          select: vi.fn(() => query),
          update: vi.fn((payload: { score: number; feedback: string; graded_by: string }) => ({
            eq: vi.fn((column: string) => {
              if (column === 'test_id') {
                return {
                  in: vi.fn(async (_idColumn: string, ids: string[]) => {
                    unansweredUpdates.push({ payload, ids })
                    return { error: null }
                  }),
                }
              }

              return {
                eq: vi.fn().mockImplementation(async () => {
                  aiUpdates.push(payload)
                  return { error: null }
                }),
              }
            }),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1', is_submitted: true, submitted_at: '2026-02-24T15:00:00.000Z' },
                { student_id: 'student-2', is_submitted: true, submitted_at: '2026-02-24T15:00:00.000Z' },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2'],
        prompt_guideline: 'Use exactly two sentences of feedback.',
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.graded_students).toBe(2)
    expect(data.skipped_students).toBe(0)
    expect(data.eligible_students).toBe(2)
    expect(data.graded_responses).toBe(2)
    expect(data.grading_strategy).toBe('balanced')
    expect(prepareTestOpenResponseGradingContext).toHaveBeenCalledTimes(1)
    expect(prepareTestOpenResponseGradingContext).toHaveBeenCalledWith(
      expect.objectContaining({
        maxPoints: 5,
        responseMonospace: true,
        answerKey: 'Arrays are ordered lists; objects map keys to values.',
        sampleSolution: 'String[] names = {"Ada", "Grace"};',
        promptGuidelineOverride: 'Use exactly two sentences of feedback.',
      })
    )
    expect(suggestTestOpenResponseGradeWithContext).toHaveBeenCalledTimes(1)
    expect(aiUpdates).toEqual([
      expect.objectContaining({
        score: 4.5,
        feedback: 'Good explanation',
        graded_by: 'teacher-1',
      }),
    ])
    expect(unansweredUpdates).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          score: 0,
          feedback: 'Unanswered',
          graded_by: 'teacher-1',
        }),
        ids: ['response-2'],
      }),
    ])
  })

  it('returns 400 when prompt_guideline is not a string', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
        prompt_guideline: 123,
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('prompt_guideline must be a string')
  })

  it('returns 400 when grading_strategy is invalid', async () => {
    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
        grading_strategy: 'nope',
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('grading_strategy must be one of: balanced, aggressive_batch')
  })

  it('skips responses already graded with the current model (zero OpenAI calls)', async () => {
    suggestTestOpenResponseGrade.mockResolvedValue({
      score: 4.5,
      feedback: 'Good explanation',
      model: 'gpt-5-nano',
      grading_basis: 'generated_reference',
      reference_answers: ['Answer here'],
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = { eq: vi.fn().mockReturnThis() } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [{ id: 'q-open-1', question_text: 'Explain arrays.', points: 5 }],
          error: null,
        }))
        return { select: vi.fn(() => query) }
      }

      if (table === 'test_responses') {
        const query = { eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis() } as any
        query.in.mockImplementationOnce(() => query)
        query.in.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'response-already-graded',
              student_id: 'student-1',
              question_id: 'q-open-1',
              response_text: 'Arrays are ordered.',
              // Already graded with the same model
              ai_model: 'gpt-5-nano',
              graded_at: '2026-03-01T12:00:00.000Z',
              score: 4.0,
            },
          ],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
          update: vi.fn(() => ({ eq: vi.fn().mockReturnThis() })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1', is_submitted: true, submitted_at: '2026-02-24T15:00:00.000Z' },
              ],
              error: null,
            }),
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
    // Response was already graded — counts as graded_responses
    expect(data.graded_responses).toBe(1)
    expect(data.graded_students).toBe(1)
    // Zero OpenAI calls made
    expect(suggestTestOpenResponseGrade).not.toHaveBeenCalled()
    expect(prepareTestOpenResponseGradingContext).not.toHaveBeenCalled()
    expect(suggestTestOpenResponseGradeWithContext).not.toHaveBeenCalled()
    expect(suggestTestOpenResponseGradesBatch).not.toHaveBeenCalled()
  })

  it('regrades already-AI-graded responses when custom instructions are provided', async () => {
    const aiUpdates: Array<{ score: number; feedback: string; graded_by: string }> = []

    prepareTestOpenResponseGradingContext.mockResolvedValue({
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: [],
    })
    suggestTestOpenResponseGradeWithContext.mockResolvedValue({
      score: 5,
      feedback: 'Strength: Clear answer. Next Step: keep this precision.',
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: [],
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = { eq: vi.fn().mockReturnThis() } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'q-open-1',
              question_text: 'Explain arrays.',
              points: 5,
              response_monospace: false,
              answer_key: 'Arrays keep items in order.',
            },
          ],
          error: null,
        }))
        return { select: vi.fn(() => query) }
      }

      if (table === 'test_responses') {
        const query = { eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis() } as any
        query.in.mockImplementationOnce(() => query)
        query.in.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'response-already-graded',
              student_id: 'student-1',
              question_id: 'q-open-1',
              response_text: 'Arrays are ordered.',
              ai_model: 'gpt-5-nano',
              graded_at: '2026-03-01T12:00:00.000Z',
              score: 4.0,
            },
          ],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
          update: vi.fn((payload: { score: number; feedback: string; graded_by: string }) => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockImplementation(async () => {
                aiUpdates.push(payload)
                return { error: null }
              }),
            })),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1', is_submitted: true, submitted_at: '2026-02-24T15:00:00.000Z' },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1'],
        prompt_guideline: 'Be stricter about terminology.',
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.graded_responses).toBe(1)
    expect(prepareTestOpenResponseGradingContext).toHaveBeenCalledTimes(1)
    expect(suggestTestOpenResponseGradeWithContext).toHaveBeenCalledTimes(1)
    expect(aiUpdates).toEqual([
      expect.objectContaining({
        score: 5,
        feedback: 'Strength: Clear answer. Next Step: keep this precision.',
        graded_by: 'teacher-1',
      }),
    ])
  })

  it('uses aggressive batch mode when requested', async () => {
    const aiUpdates: Array<{ score: number; feedback: string; graded_by: string }> = []

    prepareTestOpenResponseGradingContext.mockResolvedValue({
      model: 'gpt-5-nano',
      grading_basis: 'generated_reference',
      reference_answers: ['Reference answer'],
    })
    suggestTestOpenResponseGradesBatch.mockResolvedValue([
      {
        responseId: 'response-1',
        score: 5,
        feedback: 'Strong answer',
        model: 'gpt-5-nano',
        grading_basis: 'generated_reference',
        reference_answers: ['Reference answer'],
      },
      {
        responseId: 'response-2',
        score: 3,
        feedback: 'Partially correct',
        model: 'gpt-5-nano',
        grading_basis: 'generated_reference',
        reference_answers: ['Reference answer'],
      },
    ])

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = { eq: vi.fn().mockReturnThis() } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'q-open-1',
              question_text: 'Explain arrays.',
              points: 5,
              response_monospace: false,
              answer_key: null,
            },
          ],
          error: null,
        }))
        return { select: vi.fn(() => query) }
      }

      if (table === 'test_responses') {
        const query = { eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis() } as any
        query.in.mockImplementationOnce(() => query)
        query.in.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'response-1',
              student_id: 'student-1',
              question_id: 'q-open-1',
              response_text: 'Arrays are ordered.',
            },
            {
              id: 'response-2',
              student_id: 'student-2',
              question_id: 'q-open-1',
              response_text: 'Arrays store items.',
            },
          ],
          error: null,
        }))

        return {
          select: vi.fn(() => query),
          update: vi.fn((payload: { score: number; feedback: string; graded_by: string }) => ({
            eq: vi.fn(() => ({
              eq: vi.fn().mockImplementation(async () => {
                aiUpdates.push(payload)
                return { error: null }
              }),
            })),
          })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1', is_submitted: true, submitted_at: '2026-02-24T15:00:00.000Z' },
                { student_id: 'student-2', is_submitted: true, submitted_at: '2026-02-24T15:00:00.000Z' },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const request = new NextRequest('http://localhost:3000/api/teacher/tests/test-1/auto-grade', {
      method: 'POST',
      body: JSON.stringify({
        student_ids: ['student-1', 'student-2'],
        grading_strategy: 'aggressive_batch',
      }),
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.grading_strategy).toBe('aggressive_batch')
    expect(prepareTestOpenResponseGradingContext).toHaveBeenCalledTimes(1)
    expect(suggestTestOpenResponseGradesBatch).toHaveBeenCalledTimes(1)
    expect(suggestTestOpenResponseGradeWithContext).not.toHaveBeenCalled()
    expect(aiUpdates).toHaveLength(2)
  })

  it('sanitizes upstream AI-service failures in the response errors array', async () => {
    prepareTestOpenResponseGradingContext.mockResolvedValue({
      model: 'gpt-5-nano',
      grading_basis: 'teacher_key',
      reference_answers: [],
    })
    suggestTestOpenResponseGradeWithContext.mockRejectedValue(
      new Error('OpenAI returned invalid JSON (status 200, text/plain): An error occurred while processing your request.')
    )

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        const query = { eq: vi.fn().mockReturnThis() } as any
        query.eq.mockImplementationOnce(() => query)
        query.eq.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'q-open-1',
              question_text: 'Write a Java loop.',
              points: 5,
              response_monospace: true,
              answer_key: 'Use a counted for-loop and print each iteration value.',
            },
          ],
          error: null,
        }))
        return { select: vi.fn(() => query) }
      }

      if (table === 'test_responses') {
        const query = { eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis() } as any
        query.in.mockImplementationOnce(() => query)
        query.in.mockImplementationOnce(async () => ({
          data: [
            {
              id: 'response-1',
              student_id: 'student-1',
              question_id: 'q-open-1',
              response_text: 'for (int i = 0; i < 10; i++) { println(i); }',
            },
          ],
          error: null,
        }))
        return {
          select: vi.fn(() => query),
          update: vi.fn(() => ({ eq: vi.fn().mockReturnThis() })),
        }
      }

      if (table === 'test_attempts') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { student_id: 'student-1', is_submitted: true, submitted_at: '2026-02-24T15:00:00.000Z' },
              ],
              error: null,
            }),
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
    expect(data.graded_students).toBe(0)
    expect(data.skipped_students).toBe(1)
    expect(data.errors).toEqual([
      'student-1: AI grading service failed for this response. Try again.',
    ])
  })
})
