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
  assertTeacherOwnsTest: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

const mockUpload = vi.fn()
const mockGetPublicUrl = vi.fn()
const mockSupabase = {
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
