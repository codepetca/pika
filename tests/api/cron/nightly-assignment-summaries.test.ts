/**
 * API tests for /api/cron/nightly-assignment-summaries
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/cron/nightly-assignment-summaries/route'

describe('/api/cron/nightly-assignment-summaries', () => {
  const originalCronSecret = process.env.CRON_SECRET
  const originalNodeEnv = process.env.NODE_ENV
  const originalVercelEnv = process.env.VERCEL_ENV

  beforeEach(() => {
    vi.useFakeTimers()
    process.env.CRON_SECRET = 'test-cron-secret'
    process.env.NODE_ENV = 'test'
    delete process.env.VERCEL_ENV
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
