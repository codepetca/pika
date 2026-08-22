import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  saveSession: vi.fn(),
  createSession: vi.fn(),
  readPending: vi.fn(),
  clearPending: vi.fn(),
  verifyMagic: vi.fn(),
  resolvePikaUser: vi.fn(),
}))

vi.mock('@workos-inc/authkit-nextjs', () => ({ saveSession: mocks.saveSession }))
vi.mock('@/lib/auth', () => ({ createSession: mocks.createSession }))
vi.mock('@/lib/server/workos-magic-pending', () => ({
  readPendingWorkOSMagicAuth: mocks.readPending,
  clearPendingWorkOSMagicAuth: mocks.clearPending,
}))
vi.mock('@/lib/server/workos-magic-auth', () => ({
  verifyWorkOSMagicAuth: mocks.verifyMagic,
}))
vi.mock('@/lib/server/workos-identity', () => ({
  resolvePikaUserFromWorkOS: mocks.resolvePikaUser,
}))

import { POST } from '@/app/api/auth/workos/magic/verify/route'

function request(body: unknown) {
  return new NextRequest('http://localhost:3000/api/auth/workos/magic/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function authResponse(email = 'student@example.com') {
  return {
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    user: {
      id: 'user_workos_1',
      email,
      emailVerified: true,
    },
  }
}

describe('POST /api/auth/workos/magic/verify', () => {
  afterEach(() => vi.unstubAllEnvs())

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
    mocks.readPending.mockResolvedValue({
      email: 'student@example.com',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      intent: 'sign-in',
      nextPath: '/attendance/check-in/token-123',
      radarAuthAttemptId: 'radar_attempt_1',
    })
    mocks.verifyMagic.mockResolvedValue(authResponse())
    mocks.resolvePikaUser.mockResolvedValue({
      id: 'pika-user-1',
      email: 'student@example.com',
      role: 'student',
      workosUserId: 'user_workos_1',
    })
  })

  it('returns directly to the native Pika attendance entry after verification', async () => {
    mocks.verifyMagic.mockResolvedValue({
      ...authResponse(),
      authkitAuthorizationCode: 'ignored_cross_application_code',
    })

    const response = await POST(request({ code: '123456' }))
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.redirectUrl).toBe('/attendance/check-in/token-123')
    expect(data).not.toHaveProperty('baraHandoff')
  })

  it('requires a signed pending challenge', async () => {
    mocks.readPending.mockResolvedValue(null)
    const response = await POST(request({ code: '123456' }))

    expect(response.status).toBe(401)
    expect(mocks.verifyMagic).not.toHaveBeenCalled()
  })

  it('clears an expired challenge before rejecting it', async () => {
    mocks.readPending.mockResolvedValue({
      email: 'student@example.com',
      expiresAt: new Date(Date.now() - 1_000).toISOString(),
      intent: 'sign-in',
      nextPath: '/classrooms',
    })
    const response = await POST(request({ code: '123456' }))

    expect(response.status).toBe(401)
    expect(mocks.clearPending).toHaveBeenCalledOnce()
    expect(mocks.verifyMagic).not.toHaveBeenCalled()
  })

  it('rejects non-six-digit input before calling WorkOS', async () => {
    const response = await POST(request({ code: '12ab' }))

    expect(response.status).toBe(400)
    expect(mocks.verifyMagic).not.toHaveBeenCalled()
  })

  it('saves the WorkOS session before the Pika compatibility session', async () => {
    const order: string[] = []
    mocks.saveSession.mockImplementation(async () => { order.push('workos') })
    mocks.createSession.mockImplementation(async () => { order.push('pika') })
    const req = request({ code: '123456' })
    const response = await POST(req)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.verifyMagic).toHaveBeenCalledWith(expect.objectContaining({
      email: 'student@example.com',
      code: '123456',
      radarAuthAttemptId: 'radar_attempt_1',
      request: req,
    }))
    expect(mocks.saveSession).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: 'access-token',
    }), req)
    expect(mocks.createSession).toHaveBeenCalledWith(
      'pika-user-1',
      'student@example.com',
      'student',
      { workosUserId: 'user_workos_1' },
    )
    expect(order).toEqual(['workos', 'pika'])
    expect(mocks.clearPending).toHaveBeenCalledOnce()
    expect(data.redirectUrl).toBe('/attendance/check-in/token-123')
  })

  it('fails closed if WorkOS returns another email', async () => {
    mocks.verifyMagic.mockResolvedValue(authResponse('other@example.com'))
    const response = await POST(request({ code: '123456' }))

    expect(response.status).toBe(409)
    expect(mocks.resolvePikaUser).not.toHaveBeenCalled()
    expect(mocks.saveSession).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})
