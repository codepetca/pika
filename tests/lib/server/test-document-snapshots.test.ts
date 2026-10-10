import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DOCUMENT_MAX_SIZE } from '@/lib/test-documents'
import { fetchSafeExternalDocument } from '@/lib/server/safe-external-document'
import { syncExternalLinkTestDocument } from '@/lib/server/test-document-snapshots'
import {
  createProvisionalTestDocumentSnapshotCleanup,
} from '@/lib/server/test-document-snapshot-storage-cleanup'
import { queueManagedStorageCleanupBestEffort, type reserveManagedStorageUpload } from '@/lib/server/managed-storage'

const mockUpload = vi.fn()
const mockSupabase = {
  storage: {
    from: vi.fn(() => ({
      upload: mockUpload,
    })),
  },
}

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/server/safe-external-document', () => ({
  fetchSafeExternalDocument: vi.fn(),
}))

vi.mock('@/lib/server/test-document-snapshot-storage-cleanup', () => ({
  createProvisionalTestDocumentSnapshotCleanup: vi.fn(),
}))
vi.mock('@/lib/server/managed-storage', () => ({
  reserveManagedStorageUpload: vi.fn(async () => null),
  verifyManagedStorageUpload: vi.fn(),
  queueManagedStorageCleanupBestEffort: vi.fn(),
}))

describe('syncExternalLinkTestDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(fetchSafeExternalDocument).mockResolvedValue({
      body: Buffer.from(
        '<html><head><script>bad()</script></head><body>Docs</body></html>',
      ),
      finalUrl: 'https://docs.example.com/final',
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      status: 200,
    })
    mockUpload.mockResolvedValue({ error: null })
    vi.mocked(createProvisionalTestDocumentSnapshotCleanup).mockImplementation(
      async ({ storagePath }) => ({
        id: '10000000-0000-4000-8000-000000000001',
        storage_path: storagePath,
      }),
    )
  })

  it('uses the safe fetch boundary and stores a unique immutable snapshot', async () => {
    const result = await syncExternalLinkTestDocument({
      teacherId: 'teacher-1',
      testId: 'test-1',
      doc: {
        id: 'doc-1',
        title: 'Reference',
        source: 'link',
        url: 'https://docs.example.com/start',
      },
    })

    expect(fetchSafeExternalDocument).toHaveBeenCalledWith(
      'https://docs.example.com/start',
      TEST_DOCUMENT_MAX_SIZE,
    )
    expect(mockUpload).toHaveBeenCalledWith(
      expect.stringMatching(
        /^link-docs\/teacher-1\/test-1\/doc-1\/snapshots\/[0-9a-f-]+$/,
      ),
      expect.any(Buffer),
      {
        contentType: 'text/html',
        upsert: false,
      },
    )
    expect(createProvisionalTestDocumentSnapshotCleanup).toHaveBeenCalledWith({
      supabase: mockSupabase,
      storagePath: expect.stringMatching(
        /^link-docs\/teacher-1\/test-1\/doc-1\/snapshots\/[0-9a-f-]+$/,
      ),
    })
    const uploadedBody = mockUpload.mock.calls[0][1] as Buffer
    expect(uploadedBody.toString('utf8')).not.toContain('<script>')
    expect(uploadedBody.toString('utf8')).toContain(
      '<base href="https://docs.example.com/final">',
    )
    expect(result.snapshot_path).toMatch(
      /^link-docs\/teacher-1\/test-1\/doc-1\/snapshots\/[0-9a-f-]+$/,
    )
  })

  it('does not upload unsupported response content', async () => {
    vi.mocked(fetchSafeExternalDocument).mockResolvedValue({
      body: Buffer.from('{}'),
      finalUrl: 'https://docs.example.com/data',
      headers: new Headers({ 'content-type': 'application/json' }),
      status: 200,
    })

    await expect(
      syncExternalLinkTestDocument({
        teacherId: 'teacher-1',
        testId: 'test-1',
        doc: {
          id: 'doc-1',
          title: 'Reference',
          source: 'link',
          url: 'https://docs.example.com/data',
        },
      }),
    ).rejects.toThrow('Unsupported document type')

    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('does not upload without durable provisional cleanup evidence', async () => {
    vi.mocked(createProvisionalTestDocumentSnapshotCleanup).mockResolvedValueOnce(null)

    await expect(
      syncExternalLinkTestDocument({
        teacherId: 'teacher-1',
        testId: 'test-1',
        doc: {
          id: 'doc-1',
          title: 'Reference',
          source: 'link',
          url: 'https://docs.example.com/data',
        },
      }),
    ).rejects.toThrow('migration 110')

    expect(mockUpload).not.toHaveBeenCalled()
  })

  const sharedInput = () => ({ teacherId: 'teacher-1', classroomId: 'classroom-1', testId: 'test-1',
    doc: { id: 'doc-1', title: 'Reference', source: 'link' as const, url: 'https://docs.example.com/start' } })
  const reserveShared = async (input: Parameters<typeof reserveManagedStorageUpload>[0]) => ({
    id: input.objectId, storage_bucket: input.bucket, storage_path: input.path, status: 'reserved' as const,
  })
  const verifyShared = async () => ({ id: '10000000-0000-4000-8000-000000000001',
    storage_bucket: 'test-documents' as const, storage_path: 'snapshot', status: 'verified' as const })

  it('never falls back to a provisional legacy reservation for shared managed hooks', async () => {
    const reserve = vi.fn(async () => null); const verify = vi.fn(verifyShared)
    await expect(syncExternalLinkTestDocument({ ...sharedInput(), managedStorage: { reserve, verify } })).rejects.toMatchObject({ statusCode: 503 })
    expect(createProvisionalTestDocumentSnapshotCleanup).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled(); expect(verify).not.toHaveBeenCalled()
  })

  it('uses shared reservation and verification hooks without legacy cleanup ownership', async () => {
    const reserve = vi.fn(reserveShared); const verify = vi.fn(verifyShared)
    const result = await syncExternalLinkTestDocument({ ...sharedInput(), managedStorage: { reserve, verify } })
    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ classroomId: 'classroom-1', resourceId: 'test-1',
      purpose: 'test_execution_snapshot', path: result.snapshot_path, contentType: 'text/html' }))
    expect(verify).toHaveBeenCalledWith(result.snapshot_managed_object_id)
    expect(createProvisionalTestDocumentSnapshotCleanup).not.toHaveBeenCalled()
    expect(queueManagedStorageCleanupBestEffort).not.toHaveBeenCalled()
  })

  it.each(['upload', 'verification'])('leaves shared %s failures to reservation expiry rather than generic cleanup', async phase => {
    const reserve = vi.fn(reserveShared); const verify = vi.fn(verifyShared)
    if (phase === 'upload') mockUpload.mockResolvedValueOnce({ error: { message: 'failed' } })
    else verify.mockRejectedValueOnce(new Error('failed'))
    await expect(syncExternalLinkTestDocument({ ...sharedInput(), managedStorage: { reserve, verify } })).rejects.toThrow()
    expect(createProvisionalTestDocumentSnapshotCleanup).not.toHaveBeenCalled()
    expect(queueManagedStorageCleanupBestEffort).not.toHaveBeenCalled()
  })
})
