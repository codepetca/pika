/**
 * Unit tests for Supabase client initialization (src/lib/supabase.ts)
 * Tests client creation and configuration
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @supabase/supabase-js
const mockCreateClient = vi.fn(() => ({
  from: vi.fn(),
  auth: vi.fn(),
  storage: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}))

describe('supabase utilities', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.clearAllMocks()
    // Reset env vars
    process.env = { ...originalEnv }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test_key'
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test_key'

    // Clear module cache to reload with new env vars
    vi.resetModules()
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // ==========================================================================
  // supabase client initialization
  // ==========================================================================

  describe('supabase client', () => {
    it('should initialize client with correct URL', async () => {
      // Import after env vars are set
      const { getSupabaseClient } = await import('@/lib/supabase')

      getSupabaseClient()

      expect(mockCreateClient).toHaveBeenCalledWith(
        'https://test.supabase.co',
        expect.any(String)
      )
    })

    it('should use publishable key for main client', async () => {
      const { getSupabaseClient } = await import('@/lib/supabase')

      getSupabaseClient()

      expect(mockCreateClient).toHaveBeenCalledWith(
        expect.any(String),
        'sb_publishable_test_key'
      )
    })

    it('should throw error when NEXT_PUBLIC_SUPABASE_URL is missing', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
      vi.resetModules()

      const { getSupabaseClient } = await import('@/lib/supabase')

      expect(() => getSupabaseClient()).toThrow('Missing Supabase environment variables')
    })

    it('should throw error when NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      vi.resetModules()

      const { getSupabaseClient } = await import('@/lib/supabase')

      expect(() => getSupabaseClient()).toThrow('Missing Supabase environment variables')
    })
  })

  // ==========================================================================
  // getServiceRoleClient()
  // ==========================================================================

  describe('getServiceRoleClient', () => {
    it('should create client with secret key', async () => {
      const { getServiceRoleClient } = await import('@/lib/supabase')

      getServiceRoleClient()

      expect(mockCreateClient).toHaveBeenLastCalledWith(
        'https://test.supabase.co',
        'sb_secret_test_key',
        expect.objectContaining({
          auth: expect.any(Object),
        })
      )
    })

    it('should set autoRefreshToken to false', async () => {
      const { getServiceRoleClient } = await import('@/lib/supabase')

      getServiceRoleClient()

      expect(mockCreateClient).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({
            autoRefreshToken: false,
          }),
        })
      )
    })

    it('should set persistSession to false', async () => {
      const { getServiceRoleClient } = await import('@/lib/supabase')

      getServiceRoleClient()

      expect(mockCreateClient).toHaveBeenLastCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: expect.objectContaining({
            persistSession: false,
          }),
        })
      )
    })

    it('should throw error when SUPABASE_SECRET_KEY is missing', async () => {
      delete process.env.SUPABASE_SECRET_KEY
      vi.resetModules()

      const { getServiceRoleClient } = await import('@/lib/supabase')

      expect(() => getServiceRoleClient()).toThrow('Missing SUPABASE_SECRET_KEY')
    })

    it('should return new client instance each call', async () => {
      const { getServiceRoleClient } = await import('@/lib/supabase')

      const client1 = getServiceRoleClient()
      const client2 = getServiceRoleClient()

      // Both should be function calls (not the same cached instance)
      expect(mockCreateClient).toHaveBeenCalledTimes(2)
    })

    it('should use same URL as main client', async () => {
      const { getServiceRoleClient } = await import('@/lib/supabase')

      getServiceRoleClient()
      getServiceRoleClient()

      // Check that all calls use the same URL
      const calls = mockCreateClient.mock.calls
      const urls = calls.map(call => call[0])
      expect(urls.every(url => url === 'https://test.supabase.co')).toBe(true)
    })
  })
})
