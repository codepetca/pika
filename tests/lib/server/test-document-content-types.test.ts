import { describe, expect, it, vi } from 'vitest'
import { resolveTestDocumentUploadContentTypes } from '@/lib/server/test-document-content-types'
import { isPdfTestDocument } from '@/lib/test-documents'
import { getServiceRoleClient } from '@/lib/supabase'

function storageClient(objects: Array<Record<string, unknown>>, error: unknown = null) {
  const info = vi.fn().mockResolvedValue({ data: { contentType: 'application/pdf' }, error: null })
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data: objects, error }),
  }
  return {
    client: {
      from: vi.fn().mockReturnValue(query),
      storage: { from: vi.fn().mockReturnValue({
        info,
      }) },
    } as unknown as ReturnType<typeof getServiceRoleClient>,
    query,
    info,
  }
}

describe('resolveTestDocumentUploadContentTypes', () => {
  const documents = [
    {
      id: 'pdf', title: 'PDF', source: 'upload', storage_path: 'classroom/pdf.txt',
      managed_object_id: 'object-pdf',
    },
    {
      id: 'text', title: 'Text', source: 'upload', storage_path: 'classroom/text.pdf',
      managed_object_id: 'object-text', upload_content_type: 'application/pdf',
    },
  ]

  it('uses registered MIME rather than upload suffix or document JSON', async () => {
    const { client, query } = storageClient([
      { id: 'object-pdf', storage_path: 'classroom/pdf.txt', content_type: 'application/pdf' },
      { id: 'object-text', storage_path: 'classroom/text.pdf', content_type: 'text/plain' },
    ])

    const resolved = await resolveTestDocumentUploadContentTypes(documents, 'classroom-1', client)

    expect(resolved.map(isPdfTestDocument)).toEqual([true, false])
    expect(query.eq).toHaveBeenCalledWith('classroom_id', 'classroom-1')
    expect(resolved[1].upload_content_type).toBe('text/plain')
  })

  it('fails closed when MIME cannot be verified', async () => {
    const { client } = storageClient([], { message: 'Database unavailable' })
    const resolved = await resolveTestDocumentUploadContentTypes(documents, 'classroom-1', client)

    expect(resolved.map(isPdfTestDocument)).toEqual([false, false])
    expect(resolved[1].upload_content_type).toBeUndefined()
  })

  it('checks storage metadata for a pre-managed upload', async () => {
    const { client } = storageClient([])
    const resolved = await resolveTestDocumentUploadContentTypes([{
      id: 'legacy', title: 'Legacy PDF', source: 'upload',
      storage_path: 'classroom/legacy.pdf',
    }], 'classroom-1', client)

    expect(resolved.map(isPdfTestDocument)).toEqual([true])
  })

  it('checks storage metadata for a registered legacy object without MIME', async () => {
    const { client, info } = storageClient([
      { id: 'object-pdf', storage_path: 'classroom/pdf.txt', content_type: null },
    ])
    const resolved = await resolveTestDocumentUploadContentTypes([documents[0]], 'classroom-1', client)

    expect(resolved.map(isPdfTestDocument)).toEqual([true])
    expect(info).toHaveBeenCalledWith('classroom/pdf.txt')
  })
})
