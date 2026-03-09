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
vi.mock('@/lib/ai-test-grading', () => ({
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
    const aiUpdates: Array<{ score: number; feedback: string; graded_by: string }> = []
    const unansweredUpdates: Array<{
      payload: { score: number; feedback: string; graded_by: string }
      ids: string[]
    }> = []

    suggestTestOpenResponseGrade.mockResolvedValue({
      score: 4.5,
      feedback: 'Good explanation',
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
    expect(suggestTestOpenResponseGrade).toHaveBeenCalledTimes(1)
    expect(suggestTestOpenResponseGrade).toHaveBeenCalledWith(
      expect.objectContaining({
        responseMonospace: true,
        answerKey: 'Arrays are ordered lists; objects map keys to values.',
        promptGuidelineOverride: 'Use exactly two sentences of feedback.',
      })
    )
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
})
