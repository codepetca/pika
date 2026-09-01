import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DELETE, PATCH, POST } from '@/app/api/teacher/tests/[id]/documents/upload/route'

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
    test: { classroom_id: 'classroom-1' },
  })),
}))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn(() => mockSupabase) }))

const documentId = '10000000-0000-4000-8000-000000000001'
const objectId = '20000000-0000-4000-8000-000000000001'
const createSignedUploadUrl = vi.fn()
const info = vi.fn()
let managedObject: Record<string, unknown>

const mockSupabase = {
  rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'begin_managed_storage_upload') {
      managedObject = {
        ...managedObject,
        id: args.p_object_id,
        storage_path: args.p_storage_path,
        content_type: args.p_content_type,
        byte_size: args.p_byte_size,
      }
      return { data: managedObject, error: null }
    }
    if (name === 'verify_managed_storage_upload') {
      return { data: { ...managedObject, status: 'verified' }, error: null }
    }
    return { data: true, error: null }
  }),
  from: vi.fn(() => {
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: managedObject, error: null })),
    }
    return query
  }),
  storage: {
    from: vi.fn(() => ({ createSignedUploadUrl, info })),
  },
}

function request(method: string, body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/teacher/tests/test-1/documents/upload', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ id: 'test-1' }) }

describe('/api/teacher/tests/[id]/documents/upload direct storage flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(objectId)
    managedObject = {
      id: objectId,
      storage_bucket: 'test-documents',
      storage_path: `classrooms/classroom-1/tests/test-1/documents/${documentId}/${objectId}.pdf`,
      status: 'reserved',
      purpose: 'teacher_test_material',
      classroom_id: 'classroom-1',
      created_by_user_id: 'teacher-1',
      resource_type: 'test',
      resource_id: 'test-1',
      content_type: 'application/pdf',
      byte_size: 8,
    }
    createSignedUploadUrl.mockResolvedValue({
      data: {
        token: 'signed-upload-token',
        signedUrl: 'https://project.supabase.co/storage/v1/object/upload/sign/test-documents/guide.pdf?token=signed-upload-token',
      },
      error: null,
    })
    info.mockResolvedValue({
      data: { size: 8, contentType: 'application/pdf' },
      error: null,
    })
  })

  it('rejects incomplete and disallowed upload metadata', async () => {
    expect((await POST(request('POST', { document_id: documentId }), context)).status).toBe(400)
    expect((await POST(request('POST', {
      document_id: documentId,
      file_name: 'bad.exe',
      content_type: 'application/x-msdownload',
      byte_size: 8,
    }), context)).status).toBe(400)
  })

  it('reserves a signed direct upload without receiving the PDF body', async () => {
    const response = await POST(request('POST', {
      document_id: documentId,
      file_name: 'guide.pdf',
      content_type: 'application/pdf',
      byte_size: 8,
    }), context)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toEqual(expect.objectContaining({
      bucket: 'test-documents',
      upload_url: expect.stringContaining('token=signed-upload-token'),
      managed_object_id: objectId,
    }))
    expect(data.storage_path).toContain(`/documents/${documentId}/`)
    expect(createSignedUploadUrl).toHaveBeenCalledWith(data.storage_path, { upsert: false })
  })

  it('finalizes an exact uploaded file after size and MIME verification', async () => {
    const response = await PATCH(request('PATCH', {
      document_id: documentId,
      managed_object_id: objectId,
    }), context)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(info).toHaveBeenCalledWith(managedObject.storage_path)
    expect(data).toEqual(expect.objectContaining({
      document_id: documentId,
      storage_bucket: 'test-documents',
      managed_object_id: objectId,
    }))
  })

  it('queues an owned abandoned reservation', async () => {
    const response = await DELETE(request('DELETE', { managed_object_id: objectId }), context)
    expect(response.status).toBe(204)
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'queue_managed_storage_cleanup',
      expect.objectContaining({ p_object_id: objectId }),
    )
  })
})
