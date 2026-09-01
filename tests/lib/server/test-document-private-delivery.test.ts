import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildUploadedTestDocumentResponse } from '@/lib/server/test-document-snapshots'

vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: vi.fn() }))
import { getServiceRoleClient } from '@/lib/supabase'

const OBJECT_ID = '10000000-0000-4000-8000-000000000001'

function queryResult(data: unknown, error: unknown = null) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error })),
  }
  return query
}

function createSupabase(
  reference: unknown = { managed_object_id: OBJECT_ID },
  contentType: string | null = 'application/pdf',
) {
  const createSignedUrl = vi.fn(async () => ({
    data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/test-documents/private.pdf?token=short-lived' },
    error: null,
  }))
  const info = vi.fn(async () => ({
    data: { size: 12, contentType: 'application/pdf' },
    error: null,
  }))
  return {
    client: {
      from: vi.fn((table: string) => table === 'managed_storage_objects'
        ? queryResult({
            id: OBJECT_ID,
            storage_path: 'classrooms/class/tests/test/private.pdf',
            status: 'ready',
            purpose: 'teacher_test_material',
            classroom_id: 'class-1',
            provisional_owner_id: null,
            content_type: contentType,
          })
        : queryResult(reference)),
      storage: { from: vi.fn(() => ({ createSignedUrl, info })) },
    },
    createSignedUrl,
    info,
  }
}

const doc = {
  id: 'doc-1',
  title: 'Reference.pdf',
  source: 'upload' as const,
  storage_bucket: 'test-documents' as const,
  storage_path: 'classrooms/class/tests/test/private.pdf',
  managed_object_id: OBJECT_ID,
}

describe('private uploaded Test document delivery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires the exact managed Test reference and returns private headers', async () => {
    const { client, createSignedUrl } = createSupabase()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await buildUploadedTestDocumentResponse({
      testId: 'test-1', classroomId: 'class-1', doc,
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('location')).toContain('token=short-lived')
    expect(createSignedUrl).toHaveBeenCalledWith(doc.storage_path, 60)
  })

  it('uses Storage metadata for a registered legacy object without a saved MIME type', async () => {
    const { client, createSignedUrl, info } = createSupabase(
      { managed_object_id: OBJECT_ID },
      null,
    )
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await buildUploadedTestDocumentResponse({
      testId: 'test-1', classroomId: 'class-1', doc,
    })
    expect(response.status).toBe(302)
    expect(info).toHaveBeenCalledWith(doc.storage_path)
    expect(createSignedUrl).toHaveBeenCalled()
  })

  it('fails closed when the object is not referenced by the authorized Test', async () => {
    const { client, createSignedUrl } = createSupabase(null)
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await buildUploadedTestDocumentResponse({
      testId: 'test-1', classroomId: 'class-1', doc,
    })
    expect(response.status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })

  it('fails closed on a Classroom ownership mismatch', async () => {
    const { client, createSignedUrl } = createSupabase()
    vi.mocked(getServiceRoleClient).mockReturnValue(client as any)

    const response = await buildUploadedTestDocumentResponse({
      testId: 'test-1', classroomId: 'class-2', doc,
    })
    expect(response.status).toBe(404)
    expect(createSignedUrl).not.toHaveBeenCalled()
  })
})
