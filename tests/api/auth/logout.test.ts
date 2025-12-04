/**
 * API tests for POST /api/auth/logout
 * Tests session destruction and logout flow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/auth/logout/route'

// Mock modules
vi.mock('@/lib/auth', () => ({
  destroySession: vi.fn(async () => {}),
}))

// Import mocked modules
import { destroySession } from '@/lib/auth'

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
