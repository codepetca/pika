import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/documents/upload/route'

vi.mock('@/lib/auth', () => ({
  requireRole: vi.fn(async () => ({
    id: 'teacher-1',
    email: 'teacher@example.com',
    role: 'teacher',
  })),
}))

vi.mock('@/lib/server/tests', () => ({
  assertTeacherOwnsTest: vi.fn(async () => ({
    ok: true,
    test: { classroom_id: '10000000-0000-4000-8000-000000000001' },
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

const mockUpload = vi.fn()
const mockGetPublicUrl = vi.fn()
const mockSupabase = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => ({
    data: name === 'begin_managed_storage_upload'
      ? {
          id: args.p_object_id,
          storage_bucket: args.p_storage_bucket,
          storage_path: args.p_storage_path,
          classroom_id: args.p_classroom_id,
          course_blueprint_id: null,
          purpose: args.p_purpose,
          status: 'pending_upload',
          created_by_user_id: null,
          data_subject_user_id: null,
          resource_type: 'test',
          resource_id: null,
          content_type: 'application/pdf',
          byte_size: 8,
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
        }
      : name === 'adopt_managed_storage_upload'
        ? {
            id: args.p_object_id,
            storage_bucket: 'test-documents',
            storage_path: `classrooms/10000000-0000-4000-8000-000000000001/tests/test-1/materials/${args.p_object_id}.pdf`,
            classroom_id: '10000000-0000-4000-8000-000000000001',
            course_blueprint_id: null,
            purpose: 'teacher_test_material',
            status: 'ready',
            created_by_user_id: null,
            data_subject_user_id: null,
            resource_type: 'test',
            resource_id: null,
            content_type: 'application/pdf',
            byte_size: 8,
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
          }
        : true,
    error: null,
  })),
  storage: {
    from: vi.fn(() => ({
      upload: mockUpload,
      getPublicUrl: mockGetPublicUrl,
    })),
  },
}

function createRequest(file?: File): NextRequest {
  const formData = new FormData()
  if (file) formData.append('file', file)
  formData.append('document_id', '10000000-0000-4000-8000-000000000002')
  return { formData: async () => formData } as unknown as NextRequest
}

describe('POST /api/teacher/tests/[id]/documents/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpload.mockResolvedValue({ error: null })
    mockGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://example.com/test-documents/teacher-1/test-1/file.pdf' },
    })
  })

  it('returns 400 when no file is provided', async () => {
    const response = await POST(createRequest(), { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toBe('No file provided')
  })

  it('returns 400 when file type is not allowed', async () => {
    const file = new File(['bad'], 'bad.exe', { type: 'application/x-msdownload' })
    const response = await POST(createRequest(file), { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()
    expect(response.status).toBe(400)
    expect(data.error).toContain('Invalid file type')
  })

  it('uploads valid files and returns public url', async () => {
    const file = new File(['%PDF'], 'guide.pdf', { type: 'application/pdf' })
    ;(file as any).arrayBuffer = async () => new ArrayBuffer(8)

    const response = await POST(createRequest(file), { params: Promise.resolve({ id: 'test-1' }) })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(mockUpload).toHaveBeenCalledTimes(1)
    expect(data.url).toContain('https://example.com/test-documents/')
  })
})
