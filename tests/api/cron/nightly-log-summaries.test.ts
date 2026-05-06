import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/nightly-log-summaries/route'

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
    const activeClassroomsIsSpy = vi.fn().mockResolvedValue({ data: [], error: null })
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      expect(table).toBe('entries')
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: activeClassroomsIsSpy,
          })),
        })),
      }
    })

    const response = await GET(
      new NextRequest('http://localhost:3000/api/cron/nightly-log-summaries', {
        headers: { Authorization: 'Bearer secret' },
      })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok', generated: 0, skipped: 0 })
    expect(activeClassroomsIsSpy).toHaveBeenCalledWith('classrooms.archived_at', null)
  })

  it('generates and stores a summary for active classrooms', async () => {
    vi.stubEnv('CRON_SECRET', 'secret')
    ;(mockSupabaseClient.from as any) = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn((columns: string) => {
            if (columns === 'classroom_id, classrooms!inner(archived_at)') {
              const activeClassroomQuery: any = {
                eq: vi.fn(() => activeClassroomQuery),
                is: vi.fn().mockResolvedValue({
                  data: [{ classroom_id: 'classroom-1' }],
                  error: null,
                }),
              }
              return activeClassroomQuery
            }

            const entryQuery: any = {
              eq: vi.fn(() => entryQuery),
              is: vi.fn().mockResolvedValue({
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
