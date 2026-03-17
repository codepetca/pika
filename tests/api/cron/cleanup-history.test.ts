import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/cron/cleanup-history/route'

const mockSupabaseClient = { from: vi.fn() }

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

describe('cron cleanup-history route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns 500 when CRON_SECRET is missing', async () => {
    const response = await GET(new NextRequest('http://localhost:3000/api/cron/cleanup-history'))

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'CRON_SECRET not configured' })
  })

  it('returns 401 when the bearer token is invalid', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/cleanup-history', {
        headers: { authorization: 'Bearer wrong' },
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
  })

  it('returns deleted=0 when no expired classrooms are found', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      expect(table).toBe('classrooms')
      return {
        select: vi.fn(() => ({
          not: vi.fn(() => ({
            lt: vi.fn().mockResolvedValue({ data: [], error: null }),
          })),
        })),
      }
    })

    const response = await POST(
      new NextRequest('http://localhost:3000/api/cron/cleanup-history', {
        method: 'POST',
        headers: { authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', deleted: 0 })
  })

  it('deletes assignment doc history in chunks and sums deleted counts', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    const deleteChunks: number[] = []
    const docIds = Array.from({ length: 205 }, (_, index) => ({ id: `doc-${index + 1}` }))

    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'classrooms') {
        return {
          select: vi.fn(() => ({
            not: vi.fn(() => ({
              lt: vi.fn().mockResolvedValue({
                data: [{ id: 'classroom-1' }],
                error: null,
              }),
            })),
          })),
        }
      }

      if (table === 'assignments') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 'assignment-1' }],
              error: null,
            }),
          })),
        }
      }

      if (table === 'assignment_docs') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: docIds,
              error: null,
            }),
          })),
        }
      }

      if (table === 'assignment_doc_history') {
        return {
          delete: vi.fn(() => ({
            in: vi.fn(async (_column: string, ids: string[]) => {
              deleteChunks.push(ids.length)
              return { count: ids.length, error: null }
            }),
          })),
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/cleanup-history', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', deleted: 205 })
    expect(deleteChunks).toEqual([200, 5])
  })
})
