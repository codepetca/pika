import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/nightly-log-summaries/route'
import { callOpenAIForSummary } from '@/lib/log-summary'
import { extractAndStoreDeveloperFeedbackCandidates } from '@/lib/developer-log-feedback'

const mockSupabaseClient = { from: vi.fn() }

type QueryLog = {
  inCalls: Array<{ table: string; column: string; values: string[] }>
  rangeCalls: Array<{ table: string; from: number; to: number }>
}

function createQueryLog(): QueryLog {
  return { inCalls: [], rangeCalls: [] }
}

function mockPagedTable(
  rows: Array<Record<string, any>>,
  options: {
    table?: string
    log?: QueryLog
    error?: any
  } = {},
) {
  return {
    select: vi.fn(() => {
      const filters: Array<{ column: string; values: string[] }> = []
      const filteredRows = () => rows.filter((row) =>
        filters.every((filter) => {
          if (!(filter.column in row)) return true
          return filter.values.includes(String(row[filter.column]))
        })
      )
      const query: any = {
        eq: vi.fn((column: string, value: string | boolean) => {
          filters.push({ column, values: [String(value)] })
          return query
        }),
        in: vi.fn((column: string, values: string[]) => {
          filters.push({ column, values: values.map(String) })
          if (options.table) {
            options.log?.inCalls.push({ table: options.table, column, values: values.map(String) })
          }
          return query
        }),
        is: vi.fn(() => query),
        lte: vi.fn(() => query),
        gte: vi.fn(() => query),
        order: vi.fn(() => query),
        range: vi.fn((from: number, to: number) => {
          if (options.table) {
            options.log?.rangeCalls.push({ table: options.table, from, to })
          }
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error })
          }
          return Promise.resolve({
            data: filteredRows().slice(from, to + 1),
            error: null,
          })
        }),
        maybeSingle: vi.fn(() => Promise.resolve({ data: filteredRows()[0] || null, error: options.error || null })),
        single: vi.fn(() => {
          if (options.error) {
            return Promise.resolve({ data: null, error: options.error })
          }
          const [row] = filteredRows()
          return Promise.resolve({
            data: row || null,
            error: row ? null : { code: 'PGRST116' },
          })
        }),
      }
      return query
    }),
  }
}

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

vi.mock('@/lib/tiptap-content', () => ({
  extractPlainText: vi.fn(() => 'Reflected on progress'),
  isValidTiptapContent: vi.fn(() => true),
}))

vi.mock('@/lib/log-summary', async () => {
  const actual = await vi.importActual<typeof import('@/lib/log-summary')>('@/lib/log-summary')
  return {
    ...actual,
    callOpenAIForSummary: vi.fn(async () => ({
      overview: 'Students engaged well.',
      action_items: [{ text: 'Follow up with A.B.', initials: 'A.B.' }],
    })),
    getSummaryModel: vi.fn(() => 'gpt-test'),
  }
})

vi.mock('@/lib/developer-log-feedback', async () => {
  const actual = await vi.importActual<typeof import('@/lib/developer-log-feedback')>('@/lib/developer-log-feedback')
  return {
    ...actual,
    extractAndStoreDeveloperFeedbackCandidates: vi.fn(async () => ({
      inserted: 0,
      updated: 0,
      skipped: 0,
      tableMissing: false,
    })),
    getDeveloperFeedbackModel: vi.fn(() => 'gpt-dev-feedback-test'),
  }
})

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

  it('paginates active classroom discovery and chunks class-day lookups', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const log = createQueryLog()
    const classroomIds = Array.from({ length: 51 }, (_, index) => `classroom-${index + 1}`)
    const activeEntries = Array.from({ length: 1001 }, (_, index) => ({
      id: `entry-${index + 1}`,
      classroom_id: classroomIds[index % classroomIds.length],
    }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') return mockPagedTable(activeEntries, { table, log })
      if (table === 'class_days') return mockPagedTable([], { table, log })
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', generated: 0, skipped: 0 })
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 0, to: 999 })
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 1000, to: 1999 })
    const classDayChunks = log.inCalls
      .filter((call) => call.table === 'class_days' && call.column === 'classroom_id')
      .map((call) => call.values.length)
    expect(classDayChunks).toContain(50)
    expect(classDayChunks).toContain(1)
    expect(classDayChunks.every((length) => length <= 50)).toBe(true)
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
    const summaryUpsert = vi.fn().mockResolvedValue({ error: null })
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
              in: vi.fn(() => entryQuery),
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

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'classroom_roster') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ first_name: 'Alice', last_name: 'Brown' }],
              error: null,
            }),
          })),
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
          ...mockPagedTable([]),
          upsert: summaryUpsert,
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
    expect(callOpenAIForSummary).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      { log_1: 'A.B.' },
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 20_000 })
    )
    expect(summaryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        summary_items: expect.objectContaining({
          policy_version: 'high-priority-v1',
        }),
      }),
      { onConflict: 'classroom_id,date' }
    )
    expect(extractAndStoreDeveloperFeedbackCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        classroomId: 'classroom-1',
        model: 'gpt-dev-feedback-test',
        sanitizedLogs: [{ initials: 'A.B.', text: 'Reflected on progress' }],
        sourceEntryCount: 1,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 5_000 })
    )
  })

  it('chunks profile and scoped entry reads and excludes withdrawn-student entries', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const log = createQueryLog()
    const studentIds = Array.from({ length: 51 }, (_, index) => `student-${index + 1}`)
    const activeEntries = [{ id: 'active-entry', classroom_id: 'classroom-1' }]
    const classDays = [{ id: 'class-day-1', classroom_id: 'classroom-1', is_class_day: true }]
    const entries = [
      ...studentIds.flatMap((studentId) =>
        Array.from({ length: 21 }, (_, index) => ({
          id: `entry-${studentId}-${index + 1}`,
          classroom_id: 'classroom-1',
          student_id: studentId,
          text: `${studentId} reflected on progress`,
          rich_content: null,
          updated_at: `2026-03-15T12:${String(index).padStart(2, '0')}:00.000Z`,
        }))
      ),
      {
        id: 'stale-entry',
        classroom_id: 'classroom-1',
        student_id: 'withdrawn-student',
        text: 'Withdrawn Student should not be summarized',
        rich_content: null,
        updated_at: '2026-03-15T12:59:00.000Z',
      },
    ]
    const enrollments = studentIds.map((studentId, index) => ({
      id: `enrollment-${index + 1}`,
      classroom_id: 'classroom-1',
      student_id: studentId,
    }))
    const profiles = studentIds.map((studentId, index) => ({
      id: `profile-${index + 1}`,
      user_id: studentId,
      first_name: `First${index + 1}`,
      last_name: `Last${index + 1}`,
    }))

    const activeEntriesTable = mockPagedTable(activeEntries, { table: 'entries', log })
    const detailEntriesTable = mockPagedTable(entries, { table: 'entries', log })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn((columns: string) =>
            columns === 'classroom_id, classrooms!inner(archived_at,start_date,end_date)'
              ? activeEntriesTable.select(columns)
              : detailEntriesTable.select(columns)
          ),
        }
      }
      if (table === 'class_days') return mockPagedTable(classDays, { table, log })
      if (table === 'classrooms') return mockPagedTable([{ id: 'classroom-1' }], { table, log })
      if (table === 'classroom_enrollments') return mockPagedTable(enrollments, { table, log })
      if (table === 'classroom_roster') return mockPagedTable([], { table, log })
      if (table === 'student_profiles') return mockPagedTable(profiles, { table, log })
      if (table === 'log_summaries') return { ...mockPagedTable([]), upsert: vi.fn().mockResolvedValue({ error: null }) }
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', generated: 1, skipped: 0 })
    expect(extractAndStoreDeveloperFeedbackCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        classroomId: 'classroom-1',
        sourceEntryCount: 1071,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 5_000 })
    )
    const entryStudentChunks = log.inCalls
      .filter((call) => call.table === 'entries' && call.column === 'student_id')
      .map((call) => call.values.length)
    expect(entryStudentChunks).toContain(50)
    expect(entryStudentChunks).toContain(1)
    expect(entryStudentChunks.every((length) => length <= 50)).toBe(true)
    const profileChunks = log.inCalls
      .filter((call) => call.table === 'student_profiles' && call.column === 'user_id')
      .map((call) => call.values.length)
    expect(profileChunks).toContain(50)
    expect(profileChunks).toContain(1)
    expect(profileChunks.every((length) => length <= 50)).toBe(true)
    expect(log.rangeCalls).toContainEqual({ table: 'entries', from: 1000, to: 1999 })
  })

  it('reports retryable failure when student profile hydration fails', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const activeEntries = [{ id: 'active-entry', classroom_id: 'classroom-1' }]
    const classDays = [{ id: 'class-day-1', classroom_id: 'classroom-1', is_class_day: true }]
    const detailEntries = [{
      id: 'entry-1',
      classroom_id: 'classroom-1',
      student_id: 'student-1',
      text: 'Reflected on progress',
      rich_content: null,
      updated_at: '2026-03-15T12:00:00.000Z',
    }]
    const activeEntriesTable = mockPagedTable(activeEntries)
    const detailEntriesTable = mockPagedTable(detailEntries)

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn((columns: string) =>
            columns === 'classroom_id, classrooms!inner(archived_at,start_date,end_date)'
              ? activeEntriesTable.select(columns)
              : detailEntriesTable.select(columns)
          ),
        }
      }
      if (table === 'class_days') return mockPagedTable(classDays)
      if (table === 'classrooms') return mockPagedTable([{ id: 'classroom-1' }])
      if (table === 'classroom_enrollments') {
        return mockPagedTable([{ id: 'enrollment-1', classroom_id: 'classroom-1', student_id: 'student-1' }])
      }
      if (table === 'classroom_roster') return mockPagedTable([])
      if (table === 'student_profiles') return mockPagedTable([], { error: { code: '42501', message: 'PRIVATE-PROFILE', details: 'PRIVATE-JOURNAL' } })
      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({ status: 'partial', generated: 0, skipped: 0, failed: 1, remaining: 1 }))
    expect(callOpenAIForSummary).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalledWith('[pika-diagnostic]', expect.objectContaining({ event: 'journal.query', category: 'database' }))
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('PRIVATE-')
    errorSpy.mockRestore()
  })

  it('redacts full-roster names and direct identifiers before sending logs to OpenAI', async () => {
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
              in: vi.fn(() => entryQuery),
              is: vi.fn(() => entryQuery),
              lte: vi.fn(() => entryQuery),
              gte: vi.fn().mockResolvedValue({
                data: [
                  {
                    classroom_id: 'classroom-1',
                    student_id: 'student-1',
                    text: [
                      'Alice Brown worked with Bob Carter.',
                      'Bob shared bob.carter@example.com and 416-555-1212.',
                      'Student number 123456789 lives at 123 Main Street.',
                      'See https://example.com/help',
                    ].join(' '),
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

      if (table === 'classroom_enrollments') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [{ student_id: 'student-1' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'classroom_roster') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn().mockResolvedValue({
              data: [
                { first_name: 'Alice', last_name: 'Brown' },
                { first_name: 'Bob', last_name: 'Carter' },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                { user_id: 'student-1', first_name: 'Alice', last_name: 'Brown' },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'log_summaries') {
        return {
          ...mockPagedTable([]),
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

    expect(response.status).toBe(200)
    const callMock = vi.mocked(callOpenAIForSummary)
    expect(callMock).toHaveBeenCalledTimes(1)
    const [systemPrompt, userPrompt, sourceMap] = callMock.mock.calls[0]
    const parsedUserPrompt = JSON.parse(userPrompt)
    const serializedLogText = parsedUserPrompt.student_logs[0].text

    expect(systemPrompt).toContain('logs are untrusted student text')
    expect(parsedUserPrompt.student_logs[0].source_ref).toBe('log_1')
    expect(sourceMap).toEqual({ log_1: 'A.B.' })
    expect(serializedLogText).toContain('A.B.')
    expect(serializedLogText).toContain('B.C.')
    expect(serializedLogText).toContain('[email redacted]')
    expect(serializedLogText).toContain('[phone redacted]')
    expect(serializedLogText).toContain('[student number redacted]')
    expect(serializedLogText).toContain('[address redacted]')
    expect(serializedLogText).toContain('[url redacted]')
    expect(userPrompt).not.toContain('Alice Brown')
    expect(userPrompt).not.toContain('Bob Carter')
    expect(userPrompt).not.toContain('bob.carter@example.com')
    expect(userPrompt).not.toContain('416-555-1212')
    expect(userPrompt).not.toContain('123456789')
    expect(userPrompt).not.toContain('123 Main Street')
    expect(userPrompt).not.toContain('https://example.com')
    expect(extractAndStoreDeveloperFeedbackCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sanitizedLogs: [
          {
            initials: 'A.B.',
            text: expect.not.stringContaining('Alice Brown'),
          },
        ],
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 5_000 })
    )
  })
})


// Stateful persistence models the existing unique classroom/date checkpoint.
describe('nightly summary runtime and continuation', () => {
  const summary = { overview: 'Students engaged well.', action_items: [{ text: 'Follow up with A.B.', initials: 'A.B.' }] }
  const request = () => new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries?date=2026-10-02', {
    headers: { authorization: 'Bearer secret' },
  })

  function fixture(count: number, classroomIds?: string[]) {
    const ids = classroomIds ?? Array.from({ length: count }, (_, i) => `classroom-${i + 1}`)
    const saved = new Map<string, any>()
    const entries = ids.map((classroom_id, i) => ({
      id: `entry-${i}`, classroom_id, student_id: 'student-1', text: classroomIds ? `classroom-${i + 1}` : classroom_id,
      date: '2026-10-02', rich_content: null, updated_at: '2026-10-02T12:00:00.000Z',
    }))
    const upsert = vi.fn(async (row: any) => {
      saved.set(row.classroom_id, row)
      return { error: null }
    })
    mockSupabaseClient.from = vi.fn((table: string) => {
      if (table === 'entries') return mockPagedTable(entries)
      if (table === 'class_days') return mockPagedTable(ids.map((classroom_id) => ({ classroom_id, date: '2026-10-02', is_class_day: true })))
      if (table === 'classrooms') return mockPagedTable(ids.map((id) => ({ id })))
      if (table === 'classroom_enrollments') return mockPagedTable(ids.map((classroom_id) => ({ classroom_id, student_id: 'student-1' })))
      if (table === 'student_profiles') return mockPagedTable([{ user_id: 'student-1', first_name: 'Alice', last_name: 'Brown' }])
      if (table === 'classroom_roster') return mockPagedTable([])
      if (table === 'log_summaries') return { ...mockPagedTable([...saved.values()]), upsert }
      throw new Error(`Unexpected table: ${table}`)
    })
    return { saved, upsert, entries }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T12:00:00Z'))
    vi.stubEnv('CRON_SECRET', 'secret')
    vi.mocked(callOpenAIForSummary).mockReset().mockResolvedValue(summary)
    vi.mocked(extractAndStoreDeveloperFeedbackCandidates).mockReset().mockResolvedValue({ inserted: 0, updated: 0, skipped: 0, tableMissing: false })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('bounds a hung provider, preserves other results, and retries only unfinished work', async () => {
    const { saved, upsert } = fixture(6)
    let hungSignal: AbortSignal | undefined
    let resolveLate!: (result: typeof summary) => void
    vi.mocked(callOpenAIForSummary).mockImplementation(async (_system, user, _sources, options) => {
      if (JSON.parse(user).student_logs[0].text === 'classroom-1') {
        hungSignal = options?.signal
        return new Promise((resolve) => { resolveLate = resolve })
      }
      return summary
    })
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(20_000)
    const response = await pending
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'partial', generated: 5, skipped: 0, failed: 1, remaining: 1, date: '2026-10-02', pendingClassroomIds: ['classroom-1'] })
    expect(hungSignal?.aborted).toBe(true)
    expect(saved.size).toBe(5)
    resolveLate(summary)
    await vi.advanceTimersByTimeAsync(0)
    expect(saved.size).toBe(5)
    expect(extractAndStoreDeveloperFeedbackCandidates).not.toHaveBeenCalled()
    const persisted = saved.get('classroom-2')
    vi.mocked(callOpenAIForSummary).mockResolvedValue(summary)
    const retry = await GET(request())
    expect(await retry.json()).toEqual({ status: 'ok', generated: 1, skipped: 5 })
    expect(saved.get('classroom-2')).toBe(persisted)
    expect(upsert).toHaveBeenCalledTimes(6)
  })

  it('stops before a later batch exceeds the job budget and resumes across multiple batches', async () => {
    const { saved } = fixture(11)
    vi.mocked(callOpenAIForSummary).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(summary), 18_000)))
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(36_000)
    const response = await pending
    expect(await response.json()).toEqual({ status: 'partial', generated: 10, skipped: 0, failed: 0, remaining: 1, date: '2026-10-02', pendingClassroomIds: ['classroom-11'] })
    expect(saved.size).toBe(10)
    const retryPending = GET(request())
    await vi.advanceTimersByTimeAsync(18_000)
    const retry = await retryPending
    expect(await retry.json()).toEqual({ status: 'ok', generated: 1, skipped: 10 })
    expect(saved.size).toBe(11)
  })

  it('does not let hanging optional feedback block later summary batches', async () => {
    const { saved } = fixture(6)
    vi.mocked(extractAndStoreDeveloperFeedbackCandidates).mockImplementation(() => new Promise(() => {}))
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(10_000)
    const response = await pending
    expect(await response.json()).toEqual({ status: 'ok', generated: 6, skipped: 0 })
    expect(saved.size).toBe(6)
    expect(extractAndStoreDeveloperFeedbackCandidates).toHaveBeenCalledTimes(6)
  })

  it('bounds a stalled discovery query with the whole-job deadline', async () => {
    const entries = mockPagedTable([])
    entries.select = vi.fn(() => {
      const query: any = { eq: () => query, is: () => query, lte: () => query, gte: () => query, order: () => query, range: () => new Promise(() => {}) }
      return query
    })
    mockSupabaseClient.from = vi.fn(() => entries)
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(50_000)
    const response = await pending
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'partial', generated: 0, skipped: 0, failed: 0, remaining: null, date: '2026-10-02', pendingClassroomIds: null })
  })

  it('allows targeted continuation past persistent failures in earlier batches', async () => {
    const ids = Array.from({ length: 11 }, (_, i) => `a0000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)
    const { saved } = fixture(11, ids)
    vi.mocked(callOpenAIForSummary).mockImplementation(async (_system, user) => {
      if (['classroom-1', 'classroom-6'].includes(JSON.parse(user).student_logs[0].text)) return new Promise(() => {})
      return summary
    })
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(40_000)
    const response = await pending
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.pendingClassroomIds).toEqual([ids[0], ids[5], ids[10]])
    expect(saved.has(ids[10])).toBe(false)
    const targeted = await GET(new NextRequest(`http://localhost:3000/api/cron/nightly-log-summaries?date=2026-10-02&classroomId=${ids[10].toUpperCase()}`, {
      headers: { authorization: 'Bearer secret' },
    }))
    expect(await targeted.json()).toEqual({ status: 'ok', generated: 1, skipped: 0 })
    expect(saved.has(ids[10])).toBe(true)
    expect(saved.has(ids[0])).toBe(false)
    expect(saved.has(ids[5])).toBe(false)
  })

  it('rejects an invalid classroom retry selector before discovery', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries?date=2026-10-02&classroomId=not-a-uuid', {
      headers: { authorization: 'Bearer secret' },
    }))
    expect(response.status).toBe(400)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })

  it('skips optional work when discovery and summaries consume the available budget', async () => {
    const { entries, saved } = fixture(5)
    const originalFrom = mockSupabaseClient.from.getMockImplementation()!
    let discovery = true
    mockSupabaseClient.from.mockImplementation((table: string) => {
      if (table !== 'entries' || !discovery) return originalFrom(table)
      discovery = false
      const result = mockPagedTable(entries)
      const originalSelect = result.select.getMockImplementation()!
      result.select.mockImplementation(() => {
        const query = originalSelect()
        query.range = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ data: entries, error: null }), 28_000)))
        return query
      })
      return result
    })
    vi.mocked(callOpenAIForSummary).mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(summary), 19_000)))
    const pending = GET(request())
    await vi.advanceTimersByTimeAsync(47_000)
    const response = await pending
    expect(await response.json()).toEqual({ status: 'ok', generated: 5, skipped: 0 })
    expect(saved.size).toBe(5)
    expect(extractAndStoreDeveloperFeedbackCandidates).not.toHaveBeenCalled()
  })

  it('reports a failed persistence attempt as retryable rather than completed', async () => {
    const { saved, upsert } = fixture(1)
    upsert.mockResolvedValueOnce({ error: { code: '42501' } } as any)
    const response = await GET(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ status: 'partial', generated: 0, skipped: 0, failed: 1, remaining: 1, date: '2026-10-02', pendingClassroomIds: ['classroom-1'] })
    expect(saved.size).toBe(0)
    expect(extractAndStoreDeveloperFeedbackCandidates).not.toHaveBeenCalled()
    expect(await (await GET(request())).json()).toEqual({ status: 'ok', generated: 1, skipped: 0 })
  })

  it('regenerates a changed input while retaining unchanged checkpoints', async () => {
    const { saved, entries } = fixture(2)
    await GET(request())
    const previous = saved.get('classroom-2')
    entries[0].text = 'Changed reflection'
    const retry = await GET(request())
    expect(await retry.json()).toEqual({ status: 'ok', generated: 1, skipped: 1 })
    expect(saved.get('classroom-2')).toBe(previous)
  })

  it.each(['2026-02-30', '2026-10-03', 'invalid'])('rejects invalid or future retry date %s', async (date) => {
    const response = await GET(new NextRequest(`http://localhost:3000/api/cron/nightly-log-summaries?date=${date}`, {
      headers: { authorization: 'Bearer secret' },
    }))
    expect(response.status).toBe(400)
    expect(mockSupabaseClient.from).not.toHaveBeenCalled()
  })
})
