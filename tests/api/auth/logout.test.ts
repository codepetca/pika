/**
 * API tests for POST /api/auth/logout
 * Tests session destruction and logout flow
 */

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/auth/logout/route'

const mockDeleteCookie = vi.hoisted(() => vi.fn())
const workOSMocks = vi.hoisted(() => ({
  withAuth: vi.fn(),
  revokeSession: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ delete: mockDeleteCookie })),
}))

// Mock modules
vi.mock('@/lib/auth', () => ({
  destroySession: vi.fn(async () => {}),
}))

vi.mock('@workos-inc/authkit-nextjs', () => ({
  getWorkOS: () => ({
    userManagement: { revokeSession: workOSMocks.revokeSession },
  }),
  withAuth: workOSMocks.withAuth,
}))

// Import mocked modules
import { destroySession } from '@/lib/auth'

function request(
  origin = 'https://pika.example.test',
  requestOrigin = 'https://pika.example.test',
) {
  return new NextRequest(`${requestOrigin}/api/auth/logout`, {
    method: 'POST',
    headers: { origin },
  })
}

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://pika.example.test')
    workOSMocks.withAuth.mockResolvedValue({ sessionId: 'session_workos_1' })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  // ==========================================================================
  // Success Cases
  // ==========================================================================

  describe('success cases', () => {
    it('should call destroySession', async () => {
      await POST(request(), { params: Promise.resolve({}) })

      expect(destroySession).toHaveBeenCalledTimes(1)
    })

    it('should return 200 with success message', async () => {
      const response = await POST(request(), { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        success: true,
        message: 'Logged out successfully',
      })
    })

    it('clears WorkOS and pending-challenge cookies when the pilot is enabled', async () => {
      vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
      vi.stubEnv('WORKOS_COOKIE_NAME', 'pika-wos-session')

      const response = await POST(request(), { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(workOSMocks.revokeSession).toHaveBeenCalledWith({
        sessionId: 'session_workos_1',
      })
      expect(mockDeleteCookie).toHaveBeenCalledWith('pika-wos-session')
      expect(mockDeleteCookie).toHaveBeenCalledWith('wos-session')
      expect(mockDeleteCookie).toHaveBeenCalledWith('pika_workos_magic')
    })

    it('clears local state but does not report success when WorkOS revocation fails', async () => {
      vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')
      workOSMocks.revokeSession.mockRejectedValueOnce(new Error('WorkOS unavailable'))

      const response = await POST(request(), { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
      expect(destroySession).toHaveBeenCalledOnce()
      expect(mockDeleteCookie).toHaveBeenCalledWith('wos-session')
      expect(mockDeleteCookie).toHaveBeenCalledWith('pika_workos_magic')
    })

    it('rejects cross-origin requests before changing authentication state', async () => {
      vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')

      const response = await POST(request('https://evil.example'), {
        params: Promise.resolve({}),
      })

      expect(response.status).toBe(403)
      expect(workOSMocks.withAuth).not.toHaveBeenCalled()
      expect(workOSMocks.revokeSession).not.toHaveBeenCalled()
      expect(destroySession).not.toHaveBeenCalled()
      expect(mockDeleteCookie).not.toHaveBeenCalled()
    })

    it('accepts the origin serving a Preview request when the canonical URL differs', async () => {
      vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'true')

      const response = await POST(request(
        'https://pika-preview.example.test',
        'https://pika-preview.example.test',
      ), { params: Promise.resolve({}) })

      expect(response.status).toBe(200)
      expect(destroySession).toHaveBeenCalledOnce()
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should return 500 when destroySession fails', async () => {
      ;(destroySession as any).mockRejectedValueOnce(new Error('Session destroy failed'))

      const response = await POST(request(), { params: Promise.resolve({}) })
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })
  })
})
