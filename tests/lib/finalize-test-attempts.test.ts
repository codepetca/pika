import { describe, expect, it, vi } from 'vitest'
import { finalizeUnsubmittedTestAttemptsOnClose } from '@/lib/server/finalize-test-attempts'

describe('finalizeUnsubmittedTestAttemptsOnClose', () => {
  it('converts unsubmitted draft attempts into submitted test responses', async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }))
    const updateSpy = vi.fn(() => ({
      in: vi.fn(async () => ({ error: null })),
    }))

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'test_questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({
                data: [
                  {
                    id: 'q-mc',
                    question_type: 'multiple_choice',
                    correct_option: 1,
                    points: 2,
                  },
                  {
                    id: 'q-open',
                    question_type: 'open_response',
                    correct_option: null,
                    points: 5,
                  },
                ],
                error: null,
              })),
            })),
          }
        }

        if (table === 'test_attempts') {
          const selectQuery: any = {
            eq: vi.fn().mockReturnThis(),
          }
          selectQuery.eq.mockImplementationOnce(() => selectQuery)
          selectQuery.eq.mockImplementationOnce(async () => ({
            data: [
              {
                id: 'attempt-1',
                student_id: 'student-1',
                responses: {
                  'q-mc': { question_type: 'multiple_choice', selected_option: 1 },
                  'q-open': { question_type: 'open_response', response_text: 'Draft explanation' },
                },
              },
            ],
            error: null,
          }))

          return {
            select: vi.fn(() => selectQuery),
            update: updateSpy,
          }
        }

        if (table === 'test_responses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              in: vi.fn(async () => ({ data: [], error: null })),
            })),
            upsert: upsertSpy,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await finalizeUnsubmittedTestAttemptsOnClose(mockSupabase, 'test-1')

    expect(result).toEqual({
      ok: true,
      finalized_attempts: 1,
      inserted_responses: 2,
    })
    expect(upsertSpy).toHaveBeenCalledOnce()
    expect(updateSpy).toHaveBeenCalledOnce()

    const upsertRows = upsertSpy.mock.calls[0][0]
    expect(upsertRows).toHaveLength(2)
    expect(upsertRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          test_id: 'test-1',
          question_id: 'q-mc',
          student_id: 'student-1',
          selected_option: 1,
          response_text: null,
          score: 2,
        }),
        expect.objectContaining({
          test_id: 'test-1',
          question_id: 'q-open',
          student_id: 'student-1',
          selected_option: null,
          response_text: 'Draft explanation',
          score: null,
        }),
      ])
    )

    const updatePayload = updateSpy.mock.calls[0][0]
    expect(updatePayload).toMatchObject({
      is_submitted: true,
    })
    expect(typeof updatePayload.submitted_at).toBe('string')
  })

  it('returns success when there are no unsubmitted attempts', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'test_questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [], error: null })),
            })),
          }
        }

        if (table === 'test_attempts') {
          const selectQuery: any = {
            eq: vi.fn().mockReturnThis(),
          }
          selectQuery.eq.mockImplementationOnce(() => selectQuery)
          selectQuery.eq.mockImplementationOnce(async () => ({
            data: [],
            error: null,
          }))

          return {
            select: vi.fn(() => selectQuery),
            update: vi.fn(),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await finalizeUnsubmittedTestAttemptsOnClose(mockSupabase, 'test-1')
    expect(result).toEqual({
      ok: true,
      finalized_attempts: 0,
      inserted_responses: 0,
    })
  })

  it('skips blank open-response drafts when finalizing', async () => {
    const upsertSpy = vi.fn(async () => ({ error: null }))
    const updateSpy = vi.fn(() => ({
      in: vi.fn(async () => ({ error: null })),
    }))

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'test_questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({
                data: [
                  {
                    id: 'q-open',
                    question_type: 'open_response',
                    correct_option: null,
                    points: 5,
                  },
                ],
                error: null,
              })),
            })),
          }
        }

        if (table === 'test_attempts') {
          const selectQuery: any = {
            eq: vi.fn().mockReturnThis(),
          }
          selectQuery.eq.mockImplementationOnce(() => selectQuery)
          selectQuery.eq.mockImplementationOnce(async () => ({
            data: [
              {
                id: 'attempt-blank',
                student_id: 'student-1',
                responses: {
                  'q-open': { question_type: 'open_response', response_text: '   ' },
                },
              },
            ],
            error: null,
          }))

          return {
            select: vi.fn(() => selectQuery),
            update: updateSpy,
          }
        }

        if (table === 'test_responses') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn().mockReturnThis(),
              in: vi.fn(async () => ({ data: [], error: null })),
            })),
            upsert: upsertSpy,
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await finalizeUnsubmittedTestAttemptsOnClose(mockSupabase, 'test-1')
    expect(result).toEqual({
      ok: true,
      finalized_attempts: 1,
      inserted_responses: 0,
    })
    expect(upsertSpy).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledOnce()
  })

  it('returns migration guidance when test_attempts table is missing', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'test_questions') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: [], error: null })),
            })),
          }
        }

        if (table === 'test_attempts') {
          const selectQuery: any = {
            eq: vi.fn().mockReturnThis(),
          }
          selectQuery.eq.mockImplementationOnce(() => selectQuery)
          selectQuery.eq.mockImplementationOnce(async () => ({
            data: null,
            error: { code: 'PGRST205', message: 'missing table' },
          }))

          return {
            select: vi.fn(() => selectQuery),
            update: vi.fn(),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await finalizeUnsubmittedTestAttemptsOnClose(mockSupabase, 'test-1')
    expect(result).toEqual({
      ok: false,
      status: 400,
      error: 'Tests require migration 039 to be applied',
    })
  })
})
