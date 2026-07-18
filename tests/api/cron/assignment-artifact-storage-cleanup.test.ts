import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  supabase: {},
}))

vi.mock('@/lib/server/assignment-artifact-storage-cleanup', () => ({
  runAssignmentArtifactStorageCleanup: mocks.run,
}))
vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mocks.supabase),
}))

import { GET } from '@/app/api/cron/assignment-artifact-storage-cleanup/route'

function request(secret?: string) {
  return new NextRequest('http://localhost:3000/api/cron/assignment-artifact-storage-cleanup', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

describe('assignment artifact Storage cleanup cron', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    mocks.run.mockResolvedValue({ claimed: 2, completed: 2, failed: 0 })
  })

  it('rejects unauthorized requests', async () => {
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('runs a bounded cleanup batch', async () => {
    const response = await GET(request('cron-secret'))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual({ ok: true, claimed: 2, completed: 2, failed: 0 })
    expect(mocks.run).toHaveBeenCalledWith({
      supabase: mocks.supabase,
      limit: 100,
      leaseSeconds: 120,
    })
  })

  it('returns unhealthy when any claimed cleanup fails', async () => {
    mocks.run.mockResolvedValueOnce({ claimed: 1, completed: 0, failed: 1 })
    const response = await GET(request('cron-secret'))
    expect(response.status).toBe(503)
  })
})
