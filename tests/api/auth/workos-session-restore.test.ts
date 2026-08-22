import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  withAuth: vi.fn(),
  findLinkedPikaUser: vi.fn(),
  createSession: vi.fn(),
}))

vi.mock('@workos-inc/authkit-nextjs', () => ({ withAuth: mocks.withAuth }))
vi.mock('@/lib/server/workos-identity', () => ({
  findLinkedPikaUserFromWorkOS: mocks.findLinkedPikaUser,
}))
vi.mock('@/lib/auth', () => ({ createSession: mocks.createSession }))

import { POST } from '@/app/api/auth/workos/session/restore/route'

function request(body: unknown) {
  return new NextRequest('http://localhost:3000/api/auth/workos/session/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/workos/session/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
    mocks.withAuth.mockResolvedValue({
      user: {
        id: 'user_workos_1',
        email: 'student@example.com',
        emailVerified: true,
      },
    })
    mocks.findLinkedPikaUser.mockResolvedValue({
      id: 'pika-user-1',
      email: 'student@example.com',
      role: 'student',
      workosUserId: 'user_workos_1',
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('restores the exact linked Pika session and preserves a safe return path', async () => {
    const response = await POST(request({ next: '/teacher/calendar?view=month' }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ redirectUrl: '/teacher/calendar?view=month' })
    expect(mocks.createSession).toHaveBeenCalledWith(
      'pika-user-1',
      'student@example.com',
      'student',
      {
        workosUserId: 'user_workos_1',
        recordAuthenticationEvent: false,
      },
    )
  })

  it('fails closed when the WorkOS session is absent or unverified', async () => {
    mocks.withAuth.mockResolvedValueOnce({ user: null })
    expect((await POST(request({ next: '/classrooms' }))).status).toBe(401)

    mocks.withAuth.mockResolvedValueOnce({
      user: { id: 'user_workos_1', email: 'student@example.com', emailVerified: false },
    })
    expect((await POST(request({ next: '/classrooms' }))).status).toBe(401)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('fails closed when no exact Pika identity link exists', async () => {
    mocks.findLinkedPikaUser.mockResolvedValueOnce(null)

    const response = await POST(request({ next: '/classrooms' }))

    expect(response.status).toBe(409)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('rejects unsafe return paths before restoring a session', async () => {
    const response = await POST(request({ next: '//evil.example' }))

    expect(response.status).toBe(400)
    expect(mocks.withAuth).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
  })
})
