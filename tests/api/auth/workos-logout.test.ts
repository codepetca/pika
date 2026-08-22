import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  destroySession: vi.fn(),
  deleteCookie: vi.fn(),
  getLogoutUrl: vi.fn(),
  withAuth: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ destroySession: mocks.destroySession }))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ delete: mocks.deleteCookie })),
}))
vi.mock('@workos-inc/authkit-nextjs', () => ({
  getWorkOS: () => ({
    userManagement: { getLogoutUrl: mocks.getLogoutUrl },
  }),
  withAuth: mocks.withAuth,
}))

import { POST } from '@/app/api/auth/workos/logout/route'

function request(
  origin = 'https://pika.example.test',
  requestOrigin = 'https://pika.example.test',
) {
  return new NextRequest(`${requestOrigin}/api/auth/workos/logout`, {
    method: 'POST',
    headers: { origin },
  })
}

describe('POST /api/auth/workos/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pika.example.test')
    vi.stubEnv('WORKOS_COOKIE_NAME', 'pika-wos-session')
    mocks.withAuth.mockResolvedValue({ sessionId: 'session_workos_1' })
    mocks.getLogoutUrl.mockReturnValue('https://api.workos.test/logout/session_workos_1')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('destroys both Pika and WorkOS authentication state', async () => {
    const response = await POST(request(), { params: Promise.resolve({}) })

    expect(mocks.destroySession).toHaveBeenCalledOnce()
    expect(mocks.deleteCookie).toHaveBeenCalledWith('pika-wos-session')
    expect(mocks.deleteCookie).toHaveBeenCalledWith('wos-session')
    expect(mocks.deleteCookie).toHaveBeenCalledWith('pika_workos_magic')
    expect(mocks.withAuth).toHaveBeenCalledOnce()
    expect(mocks.getLogoutUrl).toHaveBeenCalledWith({
      sessionId: 'session_workos_1',
      returnTo: 'https://pika.example.test/login',
    })
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(
      'https://api.workos.test/logout/session_workos_1',
    )
  })

  it('returns to login without invoking WorkOS when the pilot is disabled', async () => {
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')

    const response = await POST(request(), { params: Promise.resolve({}) })

    expect(mocks.destroySession).toHaveBeenCalledOnce()
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('https://pika.example.test/login')
    expect(mocks.withAuth).not.toHaveBeenCalled()
    expect(mocks.getLogoutUrl).not.toHaveBeenCalled()
  })

  it('returns locally when the WorkOS cookie no longer contains a session', async () => {
    mocks.withAuth.mockResolvedValueOnce({ sessionId: undefined })

    const response = await POST(request(), { params: Promise.resolve({}) })

    expect(response.headers.get('location')).toBe('https://pika.example.test/login')
    expect(mocks.getLogoutUrl).not.toHaveBeenCalled()
  })

  it('rejects cross-origin form posts before changing authentication state', async () => {
    const response = await POST(request('https://evil.example'), {
      params: Promise.resolve({}),
    })

    expect(response.status).toBe(403)
    expect(mocks.destroySession).not.toHaveBeenCalled()
    expect(mocks.deleteCookie).not.toHaveBeenCalled()
    expect(mocks.withAuth).not.toHaveBeenCalled()
  })

  it('accepts a Preview request while keeping the canonical provider return URL', async () => {
    const response = await POST(request(
      'https://pika-preview.example.test',
      'https://pika-preview.example.test',
    ), { params: Promise.resolve({}) })

    expect(response.status).toBe(303)
    expect(mocks.destroySession).toHaveBeenCalledOnce()
    expect(mocks.getLogoutUrl).toHaveBeenCalledWith({
      sessionId: 'session_workos_1',
      returnTo: 'https://pika.example.test/login',
    })
  })
})
