/**
 * API tests for GET /api/auth/me
 * Tests retrieving current user information
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from '@/app/api/auth/me/route'

// Mock modules
vi.mock('@/lib/auth', () => ({
  getCurrentUser: vi.fn(),
}))

// Import mocked modules
import { getCurrentUser } from '@/lib/auth'

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================================================
  // Authentication Tests
  // ==========================================================================

  describe('authentication', () => {
    it('should return 401 when user is not authenticated', async () => {
      ;(getCurrentUser as any).mockResolvedValueOnce(null)

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Not authenticated')
    })
  })

  // ==========================================================================
  // Success Cases
  // ==========================================================================

  describe('success cases', () => {
    it('should return 200 with user data for student', async () => {
      ;(getCurrentUser as any).mockResolvedValueOnce({
        id: 'user-1',
        email: 'test@example.com',
        role: 'student',
      })

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        user: {
          id: 'user-1',
          email: 'test@example.com',
          role: 'student',
        },
      })
    })

    it('should return 200 with user data for teacher', async () => {
      ;(getCurrentUser as any).mockResolvedValueOnce({
        id: 'user-teacher-1',
        email: 'teacher@gapps.yrdsb.ca',
        role: 'teacher',
      })

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toEqual({
        user: {
          id: 'user-teacher-1',
          email: 'teacher@gapps.yrdsb.ca',
          role: 'teacher',
        },
      })
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should return 500 when getCurrentUser fails', async () => {
      ;(getCurrentUser as any).mockRejectedValueOnce(new Error('Session error'))

      const response = await GET()
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to get user')
    })
  })
})
