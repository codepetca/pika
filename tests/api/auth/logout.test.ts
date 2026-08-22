/**
 * API tests for POST /api/auth/logout
 * Tests session destruction and logout flow
 */

import { afterEach, describe, it, expect, vi, beforeEach } from 'vitest'
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

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')
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
      await POST()

      expect(destroySession).toHaveBeenCalledTimes(1)
    })

    it('should return 200 with success message', async () => {
      const response = await POST()
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

      const response = await POST()

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

      const response = await POST()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
      expect(destroySession).toHaveBeenCalledOnce()
      expect(mockDeleteCookie).toHaveBeenCalledWith('wos-session')
      expect(mockDeleteCookie).toHaveBeenCalledWith('pika_workos_magic')
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should return 500 when destroySession fails', async () => {
      ;(destroySession as any).mockRejectedValueOnce(new Error('Session destroy failed'))

      const response = await POST()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })
  })
})
