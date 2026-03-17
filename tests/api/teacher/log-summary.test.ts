import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/teacher/log-summary/route'
import { mockAuthenticationError } from '../setup'

const mockSupabaseClient = { from: vi.fn() }

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

vi.mock('@/lib/tiptap-content', () => ({
  extractPlainText: vi.fn(() => 'Worked carefully'),
  isValidTiptapContent: vi.fn(() => true),
}))

vi.mock('@/lib/log-summary', () => ({
  buildInitialsMap: vi.fn(() => ({ AB: 'Alice Brown' })),
  sanitizeEntryText: vi.fn((text: string) => text),
  buildSummaryPrompt: vi.fn(() => ({ system: 'sys', user: 'usr' })),
  callOpenAIForSummary: vi.fn(async () => ({
    overview: 'Strong progress',
    action_items: [{ text: 'Check in with AB', initials: 'AB' }],
  })),
  restoreNames: vi.fn((summary: any) => ({
    overview: summary.overview,
    action_items: [{ text: 'Check in with Alice Brown' }],
  })),
  getSummaryModel: vi.fn(() => 'gpt-test'),
}))

describe('GET /api/teacher/log-summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?classroom_id=c1&date=2026-03-15')
    )

    expect(response.status).toBe(401)
  })

  it('returns 400 when required params are missing or malformed', async () => {
    const missingClassroom = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?date=2026-03-15')
    )
    expect(missingClassroom.status).toBe(400)

    const invalidDate = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?classroom_id=c1&date=2026/03/15')
    )
    expect(invalidDate.status).toBe(400)
  })

  it('returns cached summaries when the cache is fresh', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'entries') {
        return {
          select: vi.fn((columns: string, options?: Record<string, unknown>) => {
            if (columns === 'updated_at') {
              const updatedAtQuery: any = {
                eq: vi.fn(() => updatedAtQuery),
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ updated_at: '2026-03-15T12:00:00.000Z' }],
                    error: null,
                  }),
                })),
              }
              return updatedAtQuery
            }

            if (options?.head) {
              const countQuery: any = {
                eq: vi.fn(() => countQuery),
                then: vi.fn((resolve: any) =>
                  Promise.resolve(resolve({ count: 1, error: null }))
                ),
              }
              return countQuery
            }

            throw new Error(`Unexpected entries select: ${columns}`)
          }),
        }
      }

      if (table === 'log_summaries') {
        const cacheQuery: any = {
          eq: vi.fn(() => cacheQuery),
          single: vi.fn().mockResolvedValue({
            data: {
              summary_items: {
                overview: 'Strong progress',
                action_items: [{ text: 'Check in with AB', initials: 'AB' }],
              },
              initials_map: { AB: 'Alice Brown' },
              entry_count: 1,
              entries_updated_at: '2026-03-15T12:00:00.000Z',
              generated_at: '2026-03-15T13:00:00.000Z',
            },
            error: null,
          }),
        }

        return {
          select: vi.fn(() => cacheQuery),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?classroom_id=c1&date=2026-03-15')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.summary).toEqual({
      overview: 'Strong progress',
      action_items: [{ text: 'Check in with Alice Brown' }],
      generated_at: '2026-03-15T13:00:00.000Z',
    })
  })

  it('returns 403 when the classroom belongs to another teacher', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-2' },
                error: null,
              }),
            })),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?classroom_id=c1&date=2026-03-15')
    )

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' })
  })

  it('generates and caches a summary when the cache is stale', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T14:00:00.000Z'))

    const upsertSpy = vi.fn().mockResolvedValue({ error: null })

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { teacher_id: 'teacher-1' },
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'entries') {
        return {
          select: vi.fn((columns: string, options?: Record<string, unknown>) => {
            if (columns === 'updated_at') {
              const updatedAtQuery: any = {
                eq: vi.fn(() => updatedAtQuery),
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: [{ updated_at: '2026-03-15T12:00:00.000Z' }],
                    error: null,
                  }),
                })),
              }
              return updatedAtQuery
            }

            if (options?.head) {
              const countQuery: any = {
                eq: vi.fn(() => countQuery),
                then: vi.fn((resolve: any) =>
                  Promise.resolve(resolve({ count: 1, error: null }))
                ),
              }
              return countQuery
            }

            if (columns === '*') {
              const entryQuery: any = {
                eq: vi.fn((column: string) => {
                  if (column === 'date') {
                    return Promise.resolve({
                      data: [
                        {
                          id: 'entry-1',
                          student_id: 'student-1',
                          text: 'Worked carefully',
                          rich_content: null,
                          updated_at: '2026-03-15T12:00:00.000Z',
                        },
                      ],
                      error: null,
                    })
                  }
                  return entryQuery
                }),
              }
              return entryQuery
            }

            throw new Error(`Unexpected entries select: ${columns}`)
          }),
        }
      }

      if (table === 'student_profiles') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  user_id: 'student-1',
                  first_name: 'Alice',
                  last_name: 'Brown',
                },
              ],
              error: null,
            }),
          })),
        }
      }

      if (table === 'log_summaries') {
        const cacheQuery: any = {
          eq: vi.fn(() => cacheQuery),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }

        return {
          select: vi.fn(() => cacheQuery),
          upsert: upsertSpy,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?classroom_id=c1&date=2026-03-15')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.summary).toEqual({
      overview: 'Strong progress',
      action_items: [{ text: 'Check in with Alice Brown' }],
      generated_at: '2026-03-15T14:00:00.000Z',
    })
    expect(upsertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        classroom_id: 'c1',
        date: '2026-03-15',
        entry_count: 1,
        model: 'gpt-test',
      }),
      { onConflict: 'classroom_id,date' }
    )
  })
})
