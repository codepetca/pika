import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { PATCH } from '@/app/api/teacher/tests/[id]/students/[studentId]/grades/route'

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

vi.mock('@/lib/server/tests', async () => {
  const actual = await vi.importActual<any>('@/lib/server/tests')
  return {
    ...actual,
    assertTeacherOwnsTest: vi.fn(async () => ({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        classroom_id: 'classroom-1',
        classrooms: { archived_at: null },
      },
    })),
  }
})

const mockSupabaseClient = { from: vi.fn() }

function makeGradeRequest(body: unknown = {
  grades: [{ question_id: 'question-open-1', score: 1 }],
}) {
  return new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
    method: 'PATCH',
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const gradeRouteContext = {
  params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }),
}

function configureGradeWorkflow(options: {
  enrollmentError?: unknown
  questionError?: unknown
  responseError?: unknown
  upsertErrors?: unknown[]
} = {}) {
  const upsert = vi.fn()
  for (const error of options.upsertErrors || [null]) {
    upsert.mockResolvedValueOnce({ error })
  }

  ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
    if (table === 'classroom_enrollments') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: options.enrollmentError ? null : { student_id: 'student-1' },
            error: options.enrollmentError || null,
          }),
        })),
      }
    }
    if (table === 'test_questions') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: options.questionError
              ? null
              : [{ id: 'question-open-1', question_type: 'open_response', points: 5 }],
            error: options.questionError || null,
          }),
        })),
      }
    }
    if (table === 'test_responses') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: options.responseError ? null : [],
            error: options.responseError || null,
          }),
        })),
        upsert,
      }
    }
    throw new Error(`Unexpected table: ${table}`)
  })

  return { upsert }
}

describe('PATCH /api/teacher/tests/[id]/students/[studentId]/grades', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when grades are missing', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
    )

    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('grades array is required')
  })

  it.each([
    ['{', 'Invalid JSON body'],
    ['null', 'grades array is required'],
  ])('returns a deterministic 400 for malformed body %s', async (body, expectedError) => {
    const response = await PATCH(makeGradeRequest(body), gradeRouteContext)

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expectedError })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it.each([
    [
      [{ question_id: 'question-open-1', score: 1, ai_grading_basis: 'generated_reference' }],
      'Invalid grade payload',
    ],
    [
      [
        { question_id: 'question-open-1', score: 1 },
        { question_id: ' question-open-1 ', score: 2 },
      ],
      'Duplicate question_id in grades payload',
    ],
  ])('rejects invalid grade requests before access checks', async (grades, expectedError) => {
    const { assertTeacherOwnsTest } = await import('@/lib/server/tests')
    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
        method: 'PATCH',
        body: JSON.stringify({ grades }),
      }),
      { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expectedError })
    expect(assertTeacherOwnsTest).not.toHaveBeenCalled()
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('stops archived-classroom saves before grade persistence', async () => {
    const { assertTeacherOwnsTest } = await import('@/lib/server/tests')
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: false,
      status: 403,
      error: 'Classroom is archived',
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
        method: 'PATCH',
        body: JSON.stringify({ grades: [{ question_id: 'question-open-1', score: 1 }] }),
      }),
      { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Classroom is archived' })
    expect(assertTeacherOwnsTest).toHaveBeenCalledWith('teacher-1', 'test-1', {
      checkArchived: true,
    })
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('rejects students who are not enrolled before loading questions', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table !== 'classroom_enrollments') throw new Error(`Unexpected table: ${table}`)
      return {
        select: vi.fn(() => ({
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      }
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
        method: 'PATCH',
        body: JSON.stringify({ grades: [{ question_id: 'question-open-1', score: 1 }] }),
      }),
      { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Student is not enrolled in this classroom' })
    expect(mockSupabaseClient.from).toHaveBeenCalledTimes(1)
  })

  it.each([
    [[], 'One or more questions were not found for this test'],
    [[{ id: 'question-open-1', question_type: 'open_response', points: 2 }], 'score cannot exceed 2'],
  ])('rejects invalid question scope before loading responses', async (questions, expectedError) => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { student_id: 'student-1' },
              error: null,
            }),
          })),
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: questions, error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
        method: 'PATCH',
        body: JSON.stringify({ grades: [{ question_id: 'question-open-1', score: 3 }] }),
      }),
      { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expectedError })
    expect(mockSupabaseClient.from).toHaveBeenCalledTimes(2)
  })

  it.each([
    [{ enrollmentError: { message: 'enrollment failed' } }, 'Failed to validate student enrollment'],
    [{ questionError: { message: 'questions failed' } }, 'Failed to validate questions'],
    [{ responseError: { message: 'responses failed' } }, 'Failed to save grades'],
  ])('fails closed when a workflow query fails', async (options, expectedError) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { upsert } = configureGradeWorkflow(options)

    const response = await PATCH(makeGradeRequest(), gradeRouteContext)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: expectedError })
    expect(upsert).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('returns 500 when the legacy compatibility upsert also fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { upsert } = configureGradeWorkflow({
      upsertErrors: [
        { code: '42703', message: 'column test_responses.ai_grading_basis does not exist' },
        { code: 'XX000', message: 'legacy upsert failed' },
      ],
    })

    const response = await PATCH(makeGradeRequest(), gradeRouteContext)

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Failed to save grades' })
    expect(upsert).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(
      'Error upserting student grade set:',
      expect.objectContaining({ message: 'legacy upsert failed' }),
    )
    consoleError.mockRestore()
  })

  it('upserts open-response grades, creating missing response rows with empty response_text', async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { student_id: 'student-1' },
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-open-1',
                  question_type: 'open_response',
                  points: 5,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
          upsert: upsertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
        method: 'PATCH',
        body: JSON.stringify({
          grades: [
            {
              question_id: 'question-open-1',
              score: 0,
              feedback: 'No response submitted.',
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.saved_count).toBe(1)

    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(upsertSpy).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          test_id: 'test-1',
          question_id: 'question-open-1',
          student_id: 'student-1',
          selected_option: null,
          response_text: '',
          score: 0,
          feedback: 'No response submitted.',
          graded_by: 'teacher-1',
        }),
      ],
      { onConflict: 'question_id,student_id' }
    )
  })

  it('retries upsert without AI metadata when AI audit columns are unavailable', async () => {
    const upsertSpy = vi
      .fn()
      .mockResolvedValueOnce({
        error: {
          code: '42703',
          message: 'column test_responses.ai_grading_basis does not exist',
        },
      })
      .mockResolvedValueOnce({ error: null })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { student_id: 'student-1' },
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-open-1',
                  question_type: 'open_response',
                  points: 5,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          })),
          upsert: upsertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
        method: 'PATCH',
        body: JSON.stringify({
          grades: [
            {
              question_id: 'question-open-1',
              score: 1,
              feedback: 'Partial work.',
              ai_grading_basis: 'teacher_key',
              ai_model: 'gpt-5-nano',
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.saved_count).toBe(1)
    expect(upsertSpy).toHaveBeenCalledTimes(2)
    const firstPayload = upsertSpy.mock.calls[0][0][0]
    const secondPayload = upsertSpy.mock.calls[1][0][0]
    expect(firstPayload.ai_grading_basis).toBe('teacher_key')
    expect(firstPayload.ai_model).toBe('gpt-5-nano')
    expect(secondPayload.ai_grading_basis).toBeUndefined()
    expect(secondPayload.ai_model).toBeUndefined()
  })

  it('supports mixed multiple-choice and open-response saves, including clears', async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { student_id: 'student-1' },
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'question-mc-1',
                  question_type: 'multiple_choice',
                  points: 2,
                },
                {
                  id: 'question-open-1',
                  question_type: 'open_response',
                  points: 5,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'test_responses') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  question_id: 'question-mc-1',
                  selected_option: 1,
                  response_text: null,
                  submitted_at: '2026-03-08T12:00:00.000Z',
                },
                {
                  question_id: 'question-open-1',
                  selected_option: null,
                  response_text: 'Original response',
                  submitted_at: '2026-03-08T12:00:00.000Z',
                },
              ],
              error: null,
            }),
          })),
          upsert: upsertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/students/student-1/grades', {
        method: 'PATCH',
        body: JSON.stringify({
          grades: [
            {
              question_id: 'question-mc-1',
              score: 2,
            },
            {
              question_id: 'question-open-1',
              clear_grade: true,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1', studentId: 'student-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.saved_count).toBe(2)
    expect(upsertSpy).toHaveBeenCalledTimes(1)
    expect(upsertSpy).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          question_id: 'question-mc-1',
          selected_option: 1,
          submitted_at: '2026-03-08T12:00:00.000Z',
          score: 2,
          feedback: null,
          ai_grading_basis: null,
        }),
        expect.objectContaining({
          question_id: 'question-open-1',
          response_text: 'Original response',
          submitted_at: '2026-03-08T12:00:00.000Z',
          score: null,
          feedback: null,
          graded_at: null,
          graded_by: null,
          ai_grading_basis: null,
          ai_reference_answers: null,
          ai_model: null,
        }),
      ],
      { onConflict: 'question_id,student_id' }
    )
  })
})
