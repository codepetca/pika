import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '@/app/api/cron/world-cadence/route'

vi.mock('@/lib/server/world-engine', () => ({
  runWorldCadenceTick: vi.fn(async () => ({
    dailySpawned: 3,
    expired: 1,
    weeklyEvaluated: 2,
  })),
}))

describe('GET /api/cron/world-cadence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'secret-123'
  })

  it('returns 401 without valid auth header', async () => {
    const req = new NextRequest('http://localhost:3000/api/cron/world-cadence')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('runs cadence tick with valid auth header', async () => {
    const req = new NextRequest('http://localhost:3000/api/cron/world-cadence', {
      headers: { Authorization: 'Bearer secret-123' },
    })
    const res = await GET(req)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.dailySpawned).toBe(3)
  })
})

