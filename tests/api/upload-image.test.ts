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
  requireRole: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(),
}))

// Import mocked modules
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'

function mockAuthenticationError(message = 'Not authenticated') {
  const error = new Error(message)
  error.name = 'AuthenticationError'
  return error
}

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
const USER_ID = '10000000-0000-4000-8000-000000000001'
const DOC_ID = '10000000-0000-4000-8000-000000000002'
const ASSIGNMENT_ID = '10000000-0000-4000-8000-000000000003'
const CLASSROOM_ID = '10000000-0000-4000-8000-000000000004'

function createMockRequest(file?: File, assignmentDocId = DOC_ID): NextRequest {
  const formData = new FormData()
  if (file) {
    formData.append('file', file)
  }
  formData.append('assignment_doc_id', assignmentDocId)

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
    ;(requireRole as any).mockResolvedValue({
      id: USER_ID,
      email: 'test@example.com',
      role: 'student',
    })

    // Default mock for Supabase storage
    mockStorageUpload.mockResolvedValue({ error: null })
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://storage.example.com/submission-images/user-123/test.png' },
    })

    const query = (data: unknown) => {
      const builder: any = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data, error: null })),
      }
      return builder
    }
    ;(getServiceRoleClient as any).mockReturnValue({
      from: vi.fn((table: string) => table === 'assignment_docs'
        ? query({ id: DOC_ID, student_id: USER_ID, assignment_id: ASSIGNMENT_ID })
        : query({ id: ASSIGNMENT_ID, classroom_id: CLASSROOM_ID })),
      rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
        if (name === 'begin_managed_storage_upload') {
          return {
            data: {
              id: args.p_object_id,
              storage_bucket: args.p_storage_bucket,
              storage_path: args.p_storage_path,
              classroom_id: args.p_classroom_id,
              course_blueprint_id: null,
              purpose: args.p_purpose,
              status: 'pending_upload',
              created_by_user_id: USER_ID,
              data_subject_user_id: USER_ID,
              resource_type: 'assignment_doc',
              resource_id: DOC_ID,
              content_type: 'image/png',
              byte_size: 1024,
              content_sha256: null,
              upload_expires_at: null,
              attempt_count: 0,
              next_attempt_at: '2026-07-31T12:00:00.000Z',
              lease_token: null,
              lease_expires_at: null,
              last_error_code: null,
              created_at: '2026-07-31T12:00:00.000Z',
              ready_at: null,
              updated_at: '2026-07-31T12:00:00.000Z',
            },
            error: null,
          }
        }
        if (name === 'adopt_managed_storage_upload') {
          return {
            data: {
              id: args.p_object_id,
              storage_bucket: 'submission-images',
              storage_path: `classrooms/${CLASSROOM_ID}/students/${USER_ID}/assignment-docs/${DOC_ID}/${args.p_object_id}.png`,
              classroom_id: CLASSROOM_ID,
              course_blueprint_id: null,
              purpose: 'student_inline_image',
              status: 'ready',
              created_by_user_id: USER_ID,
              data_subject_user_id: USER_ID,
              resource_type: 'assignment_doc',
              resource_id: DOC_ID,
              content_type: 'image/png',
              byte_size: 1024,
              content_sha256: null,
              upload_expires_at: null,
              attempt_count: 0,
              next_attempt_at: '2026-07-31T12:00:00.000Z',
              lease_token: null,
              lease_expires_at: null,
              last_error_code: null,
              created_at: '2026-07-31T12:00:00.000Z',
              ready_at: '2026-07-31T12:00:00.000Z',
              updated_at: '2026-07-31T12:00:00.000Z',
            },
            error: null,
          }
        }
        return { data: true, error: null }
      }),
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
    it('should return 401 when requireAuth rejects unauthenticated requests', async () => {
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError())

      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
      expect(getServiceRoleClient).not.toHaveBeenCalled()
    })

    it('should return 401 when the student role boundary rejects the session', async () => {
      ;(requireRole as any).mockRejectedValueOnce(mockAuthenticationError('Student access required'))

      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(401)
      expect(data.error).toBe('Unauthorized')
      expect(getServiceRoleClient).not.toHaveBeenCalled()
    })

    it('should use requireAuth user id for storage filenames', async () => {
      ;(requireRole as any).mockResolvedValueOnce({
        id: USER_ID,
        email: 'student@example.com',
        role: 'student',
      })

      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      await POST(request)

      expect(requireRole).toHaveBeenCalledWith('student')
      expect(mockStorageUpload.mock.calls[0][0]).toMatch(
        new RegExp(`^classrooms/${CLASSROOM_ID}/students/${USER_ID}/assignment-docs/${DOC_ID}/`),
      )
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
      expect(filename).toMatch(
        new RegExp(`^classrooms/${CLASSROOM_ID}/students/${USER_ID}/assignment-docs/${DOC_ID}/`),
      )
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
      ;(requireRole as any).mockRejectedValue(new Error('Unexpected error'))

      const request = createMockRequest(createMockFile('test.png', 'image/png', 1024))
      const response = await POST(request)
      const data = await response.json()

      expect(response.status).toBe(500)
      expect(data.error).toBe('Internal server error')
    })
  })
})
