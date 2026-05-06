import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/nightly-log-summaries/route'
import { callOpenAIForSummary } from '@/lib/log-summary'

const mockSupabaseClient = { from: vi.fn() }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/tiptap-content', () => ({
  extractPlainText: vi.fn(() => 'Reflected on progress'),
  isValidTiptapContent: vi.fn(() => true),
}))

vi.mock('@/lib/log-summary', () => ({
  buildInitialsMap: vi.fn(() => ({ AB: 'Alice Brown' })),
  sanitizeEntryText: vi.fn((text: string) => text),
  buildSummaryPrompt: vi.fn(() => ({ system: 'sys', user: 'usr' })),
  callOpenAIForSummary: vi.fn(async () => ({
    overview: 'Students engaged well.',
    action_items: [{ text: 'Follow up with AB', initials: 'AB' }],
  })),
  getSummaryModel: vi.fn(() => 'gpt-test'),
}))

describe('cron nightly-log-summaries route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns 500 when CRON_SECRET is missing', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'CRON_SECRET not configured' })
  })

  it('returns 401 when the bearer token is invalid', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { authorization: 'Bearer wrong' },
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns generated=0 when there were no active classrooms yesterday', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const activeClassroomsQuery: any = {
      eq: vi.fn(() => activeClassroomsQuery),
      is: vi.fn(() => activeClassroomsQuery),
      lte: vi.fn(() => activeClassroomsQuery),
      gte: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      expect(table).toBe('entries')
      return {
        select: vi.fn(() => activeClassroomsQuery),
      }
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', generated: 0, skipped: 0 })
    expect(activeClassroomsQuery.is).toHaveBeenCalledWith('classrooms.archived_at', null)
    expect(activeClassroomsQuery.lte).toHaveBeenCalledWith('classrooms.start_date', expect.any(String))
    expect(activeClassroomsQuery.gte).toHaveBeenCalledWith('classrooms.end_date', expect.any(String))
    expect(callOpenAIForSummary).not.toHaveBeenCalled()
  })

  it('does not generate outside the classroom semester range', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      expect(table).toBe('entries')
      return {
        select: vi.fn(() => {
          const query: any = {
            eq: vi.fn(() => query),
            is: vi.fn(() => query),
            lte: vi.fn(() => query),
            gte: vi.fn().mockResolvedValue({ data: [], error: null }),
          }
          return query
        }),
      }
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', generated: 0, skipped: 0 })
    expect(callOpenAIForSummary).not.toHaveBeenCalled()
  })

  it('does not generate on non-class days', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn(() => {
            const query: any = {
              eq: vi.fn(() => query),
              is: vi.fn(() => query),
              lte: vi.fn(() => query),
              gte: vi.fn().mockResolvedValue({
                data: [{ classroom_id: 'classroom-1' }],
                error: null,
              }),
            }
            return query
          }),
        }
      }

      if (table === 'class_days') {
        return {
          select: vi.fn(() => {
            const query: any = {
              in: vi.fn(() => query),
              eq: vi.fn(() => query),
            }
            query.eq.mockReturnValueOnce(query).mockResolvedValueOnce({ data: [], error: null })
            return query
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', generated: 0, skipped: 0 })
    expect(callOpenAIForSummary).not.toHaveBeenCalled()
  })

  it('returns 500 when classroom discovery fails', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      expect(table).toBe('entries')
      return {
        select: vi.fn(() => {
          const query: any = {
            eq: vi.fn(() => query),
            is: vi.fn(() => query),
            lte: vi.fn(() => query),
            gte: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'entries failed' },
            }),
          }
          return query
        }),
      }
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch entries' })
    expect(callOpenAIForSummary).not.toHaveBeenCalled()
  })

  it('returns 500 when class-day discovery fails', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn(() => {
            const query: any = {
              eq: vi.fn(() => query),
              is: vi.fn(() => query),
              lte: vi.fn(() => query),
              gte: vi.fn().mockResolvedValue({
                data: [{ classroom_id: 'classroom-1' }],
                error: null,
              }),
            }
            return query
          }),
        }
      }

      if (table === 'class_days') {
        return {
          select: vi.fn(() => {
            const query: any = {
              in: vi.fn(() => query),
              eq: vi.fn(() => query),
            }
            query.eq
              .mockReturnValueOnce(query)
              .mockResolvedValueOnce({ data: null, error: { message: 'class days failed' } })
            return query
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch class days' })
    expect(callOpenAIForSummary).not.toHaveBeenCalled()
  })

  it('skips a classroom when the eligibility recheck no longer finds it active and in range', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn(() => {
            const query: any = {
              eq: vi.fn(() => query),
              is: vi.fn(() => query),
              lte: vi.fn(() => query),
              gte: vi.fn().mockResolvedValue({
                data: [{ classroom_id: 'classroom-1' }],
                error: null,
              }),
            }
            return query
          }),
        }
      }

      if (table === 'class_days') {
        return {
          select: vi.fn(() => {
            const query: any = {
              in: vi.fn(() => query),
              eq: vi.fn(() => query),
            }
            query.eq
              .mockReturnValueOnce(query)
              .mockResolvedValueOnce({ data: [{ classroom_id: 'classroom-1' }], error: null })
            return query
          }),
        }
      }

      if (table === 'classrooms') {
        return {
          select: vi.fn(() => {
            const query: any = {
              eq: vi.fn(() => query),
              is: vi.fn(() => query),
              lte: vi.fn(() => query),
              gte: vi.fn(() => query),
              single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
            }
            return query
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', generated: 0, skipped: 1 })
    expect(callOpenAIForSummary).not.toHaveBeenCalled()
  })

  it('skips a classroom when the eligibility recheck no longer finds a class day', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    let classDaySelectCount = 0
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn(() => {
            const query: any = {
              eq: vi.fn(() => query),
              is: vi.fn(() => query),
              lte: vi.fn(() => query),
              gte: vi.fn().mockResolvedValue({
                data: [{ classroom_id: 'classroom-1' }],
                error: null,
              }),
            }
            return query
          }),
        }
      }

      if (table === 'class_days') {
        return {
          select: vi.fn(() => {
            classDaySelectCount++
            if (classDaySelectCount === 1) {
              const query: any = {
                in: vi.fn(() => query),
                eq: vi.fn(() => query),
              }
              query.eq
                .mockReturnValueOnce(query)
                .mockResolvedValueOnce({ data: [{ classroom_id: 'classroom-1' }], error: null })
              return query
            }

            const query: any = {
              eq: vi.fn(() => query),
              single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
            }
            return query
          }),
        }
      }

      if (table === 'classrooms') {
        return {
          select: vi.fn(() => {
            const query: any = {
              eq: vi.fn(() => query),
              is: vi.fn(() => query),
              lte: vi.fn(() => query),
              gte: vi.fn(() => query),
              single: vi.fn().mockResolvedValue({ data: { id: 'classroom-1' }, error: null }),
            }
            return query
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', generated: 0, skipped: 1 })
    expect(callOpenAIForSummary).not.toHaveBeenCalled()
  })

  it('generates and stores a summary for active classrooms', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'classroom_id, classrooms!inner(archived_at,start_date,end_date)') {
              const activeClassroomQuery: any = {
                eq: vi.fn(() => activeClassroomQuery),
                is: vi.fn(() => activeClassroomQuery),
                lte: vi.fn(() => activeClassroomQuery),
                gte: vi.fn().mockResolvedValue({
                  data: [{ classroom_id: 'classroom-1' }],
                  error: null,
                }),
              }
              return activeClassroomQuery
            }

            const entryQuery: any = {
              eq: vi.fn(() => entryQuery),
              is: vi.fn(() => entryQuery),
              lte: vi.fn(() => entryQuery),
              gte: vi.fn().mockResolvedValue({
                data: [
                  {
                    classroom_id: 'classroom-1',
                    student_id: 'student-1',
                    text: 'Reflected on progress',
                    rich_content: null,
                    updated_at: '2026-03-15T12:00:00.000Z',
                  },
                ],
                error: null,
              }),
            }
            return entryQuery
          }),
        }
      }

      if (table === 'classrooms') {
        return {
          select: vi.fn(() => {
            const query: any = {
              eq: vi.fn(() => query),
              is: vi.fn(() => query),
              lte: vi.fn(() => query),
              gte: vi.fn(() => query),
              single: vi.fn().mockResolvedValue({ data: { id: 'classroom-1' }, error: null }),
            }
            return query
          }),
        }
      }

      if (table === 'class_days') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'classroom_id') {
              const query: any = {
                in: vi.fn(() => query),
                eq: vi.fn(() => query),
              }
              query.eq
                .mockReturnValueOnce(query)
                .mockResolvedValueOnce({ data: [{ classroom_id: 'classroom-1' }], error: null })
              return query
            }

            const query: any = {
              eq: vi.fn(() => query),
              single: vi.fn().mockResolvedValue({ data: { id: 'class-day-1' }, error: null }),
            }
            return query
          }),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ user_id: 'student-1', first_name: 'Alice', last_name: 'Brown' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'log_summaries') {
        return {
          upsert: vi.fn().mockResolvedValue({ error: null }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.generated).toBe(1)
    expect(data.skipped).toBe(0)
  })
})
