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

vi.mock('@/lib/log-summary', () => ({
  restoreNames: vi.fn((summary: any) => ({
    overview: summary.overview,
    action_items: [{ text: 'Check in with Alice Brown' }],
  })),
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
    expect(data).toEqual({
      summary_status: 'ready',
      summary: {
        overview: 'Strong progress',
        action_items: [{ text: 'Check in with Alice Brown' }],
        generated_at: '2026-03-15T13:00:00.000Z',
      },
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

  it('returns 404 when the classroom cannot be found', async () => {
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'not found' },
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

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Classroom not found' })
  })

  it('returns 500 when entry stats cannot be loaded', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
          select: vi.fn((columns: string) => {
            if (columns === 'updated_at') {
              const updatedAtQuery: any = {
                eq: vi.fn(() => updatedAtQuery),
                order: vi.fn(() => ({
                  limit: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'stats failed' },
                  }),
                })),
              }
              return updatedAtQuery
            }

            throw new Error(`Unexpected entries select: ${columns}`)
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?classroom_id=c1&date=2026-03-15')
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to fetch entries' })
    errorSpy.mockRestore()
  })

  it('returns 500 when entry count cannot be loaded', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
                  Promise.resolve(resolve({ count: null, error: { message: 'count failed' } }))
                ),
              }
              return countQuery
            }

            throw new Error(`Unexpected entries select: ${columns}`)
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?classroom_id=c1&date=2026-03-15')
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Failed to count entries' })
    errorSpy.mockRestore()
  })

  it('returns pending when entries exist but the cached summary is stale', async () => {
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
                overview: 'Older summary',
                action_items: [],
              },
              initials_map: {},
              entry_count: 1,
              entries_updated_at: '2026-03-15T11:00:00.000Z',
              generated_at: '2026-03-15T11:05:00.000Z',
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
    expect(data).toEqual({ summary: null, summary_status: 'pending' })
  })

  it('returns no_entries when the date has no student logs', async () => {
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
                    data: [],
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
                  Promise.resolve(resolve({ count: 0, error: null }))
                ),
              }
              return countQuery
            }

            throw new Error(`Unexpected entries select: ${columns}`)
          }),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/teacher/log-summary?classroom_id=c1&date=2026-03-15')
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ summary: null, summary_status: 'no_entries' })
  })
})
