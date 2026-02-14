import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/student/classrooms/[id]/world/route'
import { mockAuthenticationError } from '../setup'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({ id: 'student-1', role: 'student' })),
}))

vi.mock('@/lib/server/classrooms', () => ({
  assertStudentCanAccessClassroom: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/server/world-engine', () => ({
  getWorldSnapshot: vi.fn(async () => ({
    ok: true,
    data: {
      world: { id: 'pet-1', level: 1, xp: 120, overlay_enabled: true, unlocks: [] },
      dailyEvent: null,
      latestWeeklyResult: null,
    },
  })),
  claimDailyCareEvent: vi.fn(async () => ({
    ok: true,
    data: { event: null, xpAwarded: 0, newLevel: 1, newUnlocks: [] },
  })),
  setOverlayEnabled: vi.fn(async () => ({
    ok: true,
    data: { overlayEnabled: false },
  })),
}))

describe('GET /api/student/classrooms/[id]/world', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns world snapshot', async () => {
    const req = new NextRequest('http://localhost:3000/api/student/classrooms/class-1/world')
    const res = await GET(req, { params: { id: 'class-1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.world.id).toBe('pet-1')
  })

  it('returns 401 when unauthenticated', async () => {
    const { requireRole } = await import('@/lib/auth')
    ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())
    const req = new NextRequest('http://localhost:3000/api/student/classrooms/class-1/world')
    const res = await GET(req, { params: { id: 'class-1' } })
    expect(res.status).toBe(401)
  })
})

describe('POST /api/student/classrooms/[id]/world', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('claims daily event', async () => {
    const req = new NextRequest('http://localhost:3000/api/student/classrooms/class-1/world', {
      method: 'POST',
      body: JSON.stringify({ action: 'claim_daily' }),
    })
    const res = await POST(req, { params: { id: 'class-1' } })
    expect(res.status).toBe(200)
  })

  it('toggles overlay', async () => {
    const req = new NextRequest('http://localhost:3000/api/student/classrooms/class-1/world', {
      method: 'POST',
      body: JSON.stringify({ action: 'set_overlay', enabled: false }),
    })
    const res = await POST(req, { params: { id: 'class-1' } })
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.overlayEnabled).toBe(false)
  })
})

