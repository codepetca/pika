import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, PATCH } from '@/app/api/teacher/tests/[id]/route'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getAssessmentDraftByType } from '@/lib/server/assessment-drafts'
import { finalizeUnsubmittedTestAttemptsOnClose } from '@/lib/server/finalize-test-attempts'

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
      status: 'draft',
      show_results: false,
      position: 0,
      points_possible: null,
      include_in_final: false,
      created_by: 'teacher-1',
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      classrooms: { archived_at: null },
    },
  })),
}))

vi.mock('@/lib/server/assessment-drafts', () => ({
  getAssessmentDraftByType: vi.fn(async () => ({ draft: null, error: null })),
  isMissingAssessmentDraftsError: vi.fn(() => false),
  syncTestQuestionsFromDraft: vi.fn(async () => ({ ok: true })),
  updateAssessmentDraft: vi.fn(async () => ({ draft: null, error: null })),
  validateTestDraftContent: vi.fn((content: unknown) => ({ valid: true, value: content })),
}))

vi.mock('@/lib/server/finalize-test-attempts', () => ({
  finalizeUnsubmittedTestAttemptsOnClose: vi.fn(async () => ({
    ok: true,
    finalized_attempts: 0,
    inserted_responses: 0,
  })),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('PATCH /api/teacher/tests/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns canonical questions for closed tests even when a draft overlay exists', async () => {
    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Closed Test',
        classroom_id: 'classroom-1',
        status: 'closed',
        show_results: false,
        position: 0,
        points_possible: null,
        include_in_final: false,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { archived_at: null },
      } as any,
    })
    vi.mocked(getAssessmentDraftByType).mockResolvedValueOnce({
      draft: {
        id: 'draft-1',
        content: {
          title: 'Stale Draft Title',
          show_results: true,
          questions: [
            {
              id: 'q-1',
              question_type: 'open_response',
              question_text: 'Draft question text',
              options: [],
              correct_option: null,
              answer_key: null,
              sample_solution: 'stale draft sample solution',
              points: 5,
              response_max_chars: 5000,
              response_monospace: true,
            },
          ],
        },
      } as any,
      error: null,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-1',
                  test_id: 'test-1',
                  question_type: 'open_response',
                  question_text: 'Canonical question text',
                  options: [],
                  correct_option: null,
                  answer_key: null,
                  sample_solution: 'canonical sample solution',
                  points: 5,
                  response_max_chars: 5000,
                  response_monospace: true,
                  position: 0,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1'),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz.title).toBe('Closed Test')
    expect(data.quiz.show_results).toBe(false)
    expect(data.questions[0].question_text).toBe('Canonical question text')
    expect(data.questions[0].sample_solution).toBe('canonical sample solution')
  })

  it('returns 400 when activating with an incomplete question', async () => {
    const updateSpy = vi.fn()

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-1',
                  position: 0,
                  question_type: 'multiple_choice',
                  question_text: '   ',
                  options: ['Option 1', 'Option 2'],
                  correct_option: 0,
                  points: 1,
                  response_max_chars: 5000,
                  response_monospace: false,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'tests') {
        return { update: updateSpy }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Q1: Question text is required')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('activates a draft test when all questions are complete', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'q-1',
                  position: 0,
                  question_type: 'multiple_choice',
                  question_text: 'What is 2 + 2?',
                  options: ['3', '4'],
                  correct_option: 1,
                  points: 1,
                  response_max_chars: 5000,
                  response_monospace: false,
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'tests') {
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 'test-1',
                    classroom_id: 'classroom-1',
                    title: 'Unit Test',
                    status: 'active',
                    show_results: false,
                  },
                  error: null,
                }),
              })),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz.status).toBe('active')
  })

  it('updates test documents when payload is valid', async () => {
    const updateSpy = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'test-1',
              classroom_id: 'classroom-1',
              title: 'Unit Test',
              status: 'draft',
              show_results: false,
              documents: payload.documents || [],
            },
            error: null,
          }),
        })),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          update: updateSpy,
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const documents = [
      {
        id: 'doc-1',
        title: 'Java API',
        url: 'https://docs.oracle.com/en/java/',
        source: 'link',
      },
    ]

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ documents }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        documents,
      })
    )
    expect(data.quiz.documents).toEqual(documents)
  })

  it('returns 400 for invalid test documents payload', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          update: vi.fn(),
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({
          documents: [{ id: 'doc-1', title: 'Broken', url: 'javascript:alert(1)', source: 'link' }],
        }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toContain('valid id/title')
  })

  it('updates text documents when payload is valid', async () => {
    const updateSpy = vi.fn((payload: Record<string, unknown>) => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'test-1',
              classroom_id: 'classroom-1',
              title: 'Unit Test',
              status: 'draft',
              show_results: false,
              documents: payload.documents || [],
            },
            error: null,
          }),
        })),
      })),
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          update: updateSpy,
        }
      }
      if (table === 'test_questions') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const documents = [
      {
        id: 'doc-text',
        title: 'Allowed formulas',
        source: 'text',
        content: 'distance = rate * time',
      },
    ]

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ documents }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        documents,
      })
    )
    expect(data.quiz.documents).toEqual(documents)
  })

  it('finalizes draft attempts when closing an active test', async () => {
    const updateSpy = vi.fn(() => ({
      eq: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: {
              id: 'test-1',
              classroom_id: 'classroom-1',
              title: 'Unit Test',
              status: 'closed',
              show_results: false,
            },
            error: null,
          }),
        })),
      })),
    }))

    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        classroom_id: 'classroom-1',
        status: 'active',
        show_results: false,
        position: 0,
        points_possible: null,
        include_in_final: false,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { archived_at: null },
      } as any,
    })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          update: updateSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.quiz.status).toBe('closed')
    expect(finalizeUnsubmittedTestAttemptsOnClose).toHaveBeenCalledWith(mockSupabaseClient, 'test-1')
    expect(updateSpy.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(finalizeUnsubmittedTestAttemptsOnClose).mock.invocationCallOrder[0]
    )
  })

  it('reopens the test when close finalization fails', async () => {
    const updateSpy = vi.fn((payload: Record<string, unknown>) => {
      if (payload.status === 'active') {
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        }
      }

      return {
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'test-1',
                classroom_id: 'classroom-1',
                title: 'Unit Test',
                status: 'closed',
                show_results: false,
              },
              error: null,
            }),
          })),
        })),
      }
    })

    vi.mocked(assertTeacherOwnsTest).mockResolvedValueOnce({
      ok: true,
      test: {
        id: 'test-1',
        title: 'Unit Test',
        classroom_id: 'classroom-1',
        status: 'active',
        show_results: false,
        position: 0,
        points_possible: null,
        include_in_final: false,
        created_by: 'teacher-1',
        created_at: '2026-03-01T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        classrooms: { archived_at: null },
      } as any,
    })

    vi.mocked(finalizeUnsubmittedTestAttemptsOnClose).mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: 'Failed to finalize test submissions',
    } as any)

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'tests') {
        return {
          update: updateSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await PATCH(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'closed' }),
      }),
      { params: Promise.resolve({ id: 'test-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(500)
    expect(data.error).toBe('Failed to finalize test submissions')
    expect(updateSpy).toHaveBeenCalledWith({ status: 'closed' })
    expect(updateSpy).toHaveBeenCalledWith({ status: 'active' })
  })
})
