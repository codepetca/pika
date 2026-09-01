import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadFileDirectly } from '@/lib/direct-storage-upload'

describe('uploadFileDirectly', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reserves, uploads directly to the signed Supabase URL, then finalizes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bucket: 'test-documents',
          storage_path: 'path/file.pdf',
          upload_url: 'https://project.supabase.co/storage/v1/object/upload/sign/test-documents/path/file.pdf?token=upload-token',
          managed_object_id: '10000000-0000-4000-8000-000000000001',
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ managed_object_id: '10000000-0000-4000-8000-000000000001' }),
      })
    vi.stubGlobal('fetch', fetchMock)
    const file = new File(['pdf'], 'reference.pdf', { type: 'application/pdf' })

    const result = await uploadFileDirectly<{ managed_object_id: string }>({
      endpoint: '/api/upload',
      file,
      metadata: { document_id: 'doc-1' },
    })

    expect(fetchMock.mock.calls.map((call) => call[1].method)).toEqual([
      'POST',
      'PUT',
      'PATCH',
    ])
    expect(fetchMock.mock.calls[1][0]).toContain('project.supabase.co')
    expect(fetchMock.mock.calls[1][1].body).toBeInstanceOf(FormData)
    expect(fetchMock.mock.calls[1][1].headers).toEqual({ 'x-upsert': 'false' })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expect.objectContaining({
      document_id: 'doc-1',
      file_name: 'reference.pdf',
      content_type: 'application/pdf',
      byte_size: file.size,
    }))
    expect(result.managed_object_id).toBe('10000000-0000-4000-8000-000000000001')
  })

  it('best-effort cancels the reservation when direct upload fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          bucket: 'submission-images',
          storage_path: 'path/image.png',
          upload_url: 'https://project.supabase.co/storage/v1/object/upload/sign/submission-images/path/image.png?token=upload-token',
          managed_object_id: '10000000-0000-4000-8000-000000000001',
        }),
      })
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadFileDirectly({
      endpoint: '/api/upload-image',
      file: new File(['image'], 'image.png', { type: 'image/png' }),
      metadata: { assignment_doc_id: 'doc-1' },
    })).rejects.toThrow('Failed to upload file')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls[2][1].method).toBe('DELETE')
  })
})
