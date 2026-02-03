/**
 * API tests for POST /api/upload-image
 * Tests image upload validation and storage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/upload-image/route'
import { IMAGE_MAX_SIZE } from '@/lib/image-upload'

// Mock modules
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(),
}))

// Import mocked modules
import { getSession } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'

// Helper to create a mock file with arrayBuffer method
function createMockFile(
  name: string,
  type: string,
  size: number
): File {
  const buffer = new ArrayBuffer(size)
  const file = new File([buffer], name, { type })
  // Add arrayBuffer method for Node.js environment
  ;(file as any).arrayBuffer = async () => buffer
  return file
}

// Helper to create a mock request with FormData
function createMockRequest(file?: File): NextRequest {
  const formData = new FormData()
  if (file) {
    formData.append('file', file)
  }

  return {
    formData: async () => formData,
  } as unknown as NextRequest
}

describe('POST /api/upload-image', () => {
  const mockStorageUpload = vi.fn()
  const mockGetPublicUrl = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    // Default mock for authenticated user
    ;(getSession as any).mockResolvedValue({
      user: { id: 'user-123', email: 'test@example.com', role: 'student' },
    })

    // Default mock for Supabase storage
    mockStorageUpload.mockResolvedValue({ error: null })
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://storage.example.com/submission-images/user-123/test.png' },
    })

    ;(getServiceRoleClient as any).mockReturnValue({
      storage: {
        from: vi.fn(() => ({
          upload: mockStorageUpload,
          getPublicUrl: mockGetPublicUrl,
        })),
      },
    })
  })

  // ==========================================================================
  // Authentication Tests
  // ==========================================================================

  describe('authentication', () => {
    it('should return 401 when not authenticated', async () => {
      ;(getSession as any).mockResolvedValue({ user: null })

      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })

    it('should return 401 when session has no user id', async () => {
      ;(getSession as any).mockResolvedValue({ user: { email: 'test@example.com' } })

      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
    })
  })

  // ==========================================================================
  // Validation Tests
  // ==========================================================================

  describe('validation', () => {
    it('should return 400 when no file is provided', async () => {
      const request = createMockRequest()
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toBe('No file provided')
    })

    it('should return 400 for invalid file type', async () => {
      const request = createMockRequest(createMockFile('test.pdf', 'application/pdf', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('Invalid file type')
    })

    it('should return 400 for file exceeding size limit', async () => {
      const request = createMockRequest(
        createMockFile('large.png', 'image/png', IMAGE_MAX_SIZE + 1)
      )
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(400)
      expect(data.error).toContain('File too large')
    })

    it('should accept PNG files', async () => {
      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    it('should accept JPEG files', async () => {
      const request = createMockRequest(createMockFile('test.jpg', 'image/jpeg', 1024))
      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    it('should accept GIF files', async () => {
      const request = createMockRequest(createMockFile('test.gif', 'image/gif', 1024))
      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    it('should accept WebP files', async () => {
      const request = createMockRequest(createMockFile('test.webp', 'image/webp', 1024))
      const response = await POST(request)

      expect(response.status).toBe(200)
    })
  })

  // ==========================================================================
  // Success Cases
  // ==========================================================================

  describe('success cases', () => {
    it('should upload file and return public URL', async () => {
      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data.url).toBe('https://storage.example.com/submission-images/user-123/test.png')
    })

    it('should call storage upload with correct parameters', async () => {
      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      await POST(request)

      expect(mockStorageUpload).toHaveBeenCalledTimes(1)
      const [filename, buffer, options] = mockStorageUpload.mock.calls[0]

      // Filename should include user ID
      expect(filename).toMatch(/^user-123\//)
      expect(filename).toMatch(/\.png$/)
      expect(buffer).toBeInstanceOf(Buffer)
      expect(options.contentType).toBe('image/png')
      expect(options.upsert).toBe(false)
    })

    it('should generate unique filenames', async () => {
      const request1 = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const request2 = createMockRequest(createMockFile('test.png', 'image/png', 1024))

      await POST(request1)
      await POST(request2)

      const filename1 = mockStorageUpload.mock.calls[0][0]
      const filename2 = mockStorageUpload.mock.calls[1][0]

      expect(filename1).not.toBe(filename2)
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    it('should return 500 when storage upload fails', async () => {
      mockStorageUpload.mockResolvedValue({ error: new Error('Storage error') })

      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Failed to upload image')
    })

    it('should return 500 for unexpected errors', async () => {
      ;(getSession as any).mockRejectedValue(new Error('Unexpected error'))

      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })
  })
})
