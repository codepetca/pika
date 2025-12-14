/**
 * API tests for /api/cron/nightly-assignment-summaries
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/cron/nightly-assignment-summaries/route'

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabaseClient),
}))

const mockSupabaseClient = { from: vi.fn() }

describe('/api/cron/nightly-assignment-summaries', () => {
  const originalCronSecret = process.env.CRON_SECRET
  const originalNodeEnv = process.env.NODE_ENV
  const originalVercelEnv = process.env.VERCEL_ENV
  const originalOpenAiKey = process.env.OPENAI_API_KEY

  beforeEach(() => {
    vi.useFakeTimers()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.NODE_ENV = 'test'
    delete process.env.VERCEL_ENV
    delete process.env.OPENAI_API_KEY
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = originalCronSecret
    }

    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }

    if (originalVercelEnv === undefined) {
      delete process.env.VERCEL_ENV
    } else {
      process.env.VERCEL_ENV = originalVercelEnv
    }

    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey
    }
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET

    const request = new NextRequest(
      'http://localhost:3000/api/cron/nightly-assignment-summaries',
      { headers: { authorization: 'Bearer test-cron-secret' } }
    )
    const response = await GET(request)
    expect(response.status).toBe(500)
  })

  it('returns 401 when Authorization header is missing/invalid', async () => {
    const request = new NextRequest(
      'http://localhost:3000/api/cron/nightly-assignment-summaries'
    )
    const response = await GET(request)
    expect(response.status).toBe(401)
  })

  it('returns skipped when outside 1am Toronto window', async () => {
    // 12:00Z is not 1am Toronto (regardless of local runtime tz).
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))

    const request = new NextRequest(
      'http://localhost:3000/api/cron/nightly-assignment-summaries',
      { headers: { authorization: 'Bearer test-cron-secret' } }
    )
    const response = await GET(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe('skipped')
    expect(body.reason).toBe('outside_1am_toronto_window')
  })

  it('returns ok when within 1am Toronto window', async () => {
    // 06:00Z is 1am Toronto during standard time (UTC-5).
    vi.setSystemTime(new Date('2025-01-01T06:00:00Z'))

    const request = new NextRequest(
      'http://localhost:3000/api/cron/nightly-assignment-summaries',
      { headers: { authorization: 'Bearer test-cron-secret' } }
    )
    const response = await GET(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.ran).toBe(false)
  })

  it('allows force=1 in non-production environments', async () => {
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))

    const request = new NextRequest(
      'http://localhost:3000/api/cron/nightly-assignment-summaries?force=1',
      { headers: { authorization: 'Bearer test-cron-secret' } }
    )
    const response = await POST(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe('ok')
  })

  it('returns ok but does not run when OPENAI_API_KEY is not configured', async () => {
    vi.setSystemTime(new Date('2025-01-01T06:00:00Z'))

    const request = new NextRequest(
      'http://localhost:3000/api/cron/nightly-assignment-summaries',
      { headers: { authorization: 'Bearer test-cron-secret' } }
    )
    const response = await GET(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.ran).toBe(false)
    expect(body.message).toBe('OPENAI_API_KEY_not_configured')
  })

  it('generates summaries for yesterday entries that are missing summaries', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    // 06:00Z is 1am Toronto during standard time (UTC-5). Yesterday Toronto date is 2024-12-31.
    vi.setSystemTime(new Date('2025-01-01T06:00:00Z'))

    const upsertSpy = vi.fn().mockResolvedValue({ error: null })
    const mockFrom = vi.fn((table: string) => {
      if (table === 'entries') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({
                data: [
                  { id: 'e1', text: 'hello' },
                  { id: 'e2', text: 'world' },
                ],
                error: null,
              }),
            })),
          })),
        }
      }
      if (table === 'entry_summaries') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ entry_id: 'e1' }], // e1 already has a summary
              error: null,
            }),
          })),
          upsert: upsertSpy,
        }
      }
      return {}
    })
    ;(mockSupabaseClient.from as any) = mockFrom

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ output_text: 'Summary' }),
      } as any)
    )

    const request = new NextRequest(
      'http://localhost:3000/api/cron/nightly-assignment-summaries',
      { headers: { authorization: 'Bearer test-cron-secret' } }
    )
    const response = await GET(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.ran).toBe(true)
    expect(body.date).toBe('2024-12-31')
    expect(body.created).toBe(1)
    expect(upsertSpy).toHaveBeenCalledWith(
      [expect.objectContaining({ entry_id: 'e2', summary: 'Summary' })],
      { onConflict: 'entry_id' }
    )
  })

  it('rejects force=1 in production', async () => {
    process.env.NODE_ENV = 'production'
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'))

    const request = new NextRequest(
      'http://localhost:3000/api/cron/nightly-assignment-summaries?force=1',
      { headers: { authorization: 'Bearer test-cron-secret' } }
    )
    const response = await POST(request)
    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.status).toBe('skipped')
    expect(body.reason).toBe('force_not_allowed_in_production')
  })
})
