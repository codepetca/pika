/**
 * API tests for POST /api/auth/logout
 * Tests session destruction and logout flow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/logout/route'

const mockDeleteCookie = vi.hoisted(() => vi.fn())

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ delete: mockDeleteCookie })),
}))

// Mock modules
vi.mock('@/lib/auth', () => ({
  destroySession: vi.fn(async () => {}),
}))

// Import mocked modules
import { destroySession } from '@/lib/auth'

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('WORKOS_MAGIC_AUTH_PILOT', 'false')
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

      const response = await POST()

      expect(response.status).toBe(200)
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
