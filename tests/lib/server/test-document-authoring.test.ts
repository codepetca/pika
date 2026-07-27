import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateTestDocumentsAtomic } from '@/lib/server/test-document-authoring'
import {
  removeQueuedTestDocumentSnapshotPath,
} from '@/lib/server/test-document-snapshot-storage-cleanup'

vi.mock('@/lib/server/test-document-snapshot-storage-cleanup', () => ({
  removeQueuedTestDocumentSnapshotPath: vi.fn(),
}))

describe('updateTestDocumentsAtomic', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(removeQueuedTestDocumentSnapshotPath).mockResolvedValue({
      completed: true,
    })
  })

  it('preserves trusted snapshot metadata and cleans returned obsolete paths', async () => {
    const cleanupPath = 'link-docs/teacher-1/test-1/doc-old/snapshots/old'
    const rpc = vi.fn(async () => ({
      data: {
        cleanup_paths: [cleanupPath],
        test: { id: 'test-1', documents: [] },
      },
      error: null,
    }))
    const supabase = { rpc }

    const result = await updateTestDocumentsAtomic({
      supabase,
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedStatus: 'draft',
      expectedDocuments: [{
        id: 'doc-1',
        title: 'Reference',
        source: 'link',
        url: 'https://docs.example.com/reference',
        snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshots/current',
        snapshot_content_type: 'text/html',
        synced_at: '2026-07-23T12:00:00.000Z',
      }],
      proposedDocuments: [{
        id: 'doc-1',
        title: 'Renamed reference',
        source: 'link',
        url: 'https://docs.example.com/reference',
        snapshot_path: 'link-docs/attacker/test/doc/snapshots/injected',
      }],
      title: 'Updated test',
    })

    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith(
      'update_test_documents_atomic',
      expect.objectContaining({
        p_documents: [{
          id: 'doc-1',
          title: 'Renamed reference',
          source: 'link',
          url: 'https://docs.example.com/reference',
          snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshots/current',
          snapshot_content_type: 'text/html',
          synced_at: '2026-07-23T12:00:00.000Z',
        }],
        p_expected_status: 'draft',
        p_teacher_id: 'teacher-1',
        p_test_id: 'test-1',
        p_title: 'Updated test',
        p_update_title: true,
      }),
    )
    expect(removeQueuedTestDocumentSnapshotPath).toHaveBeenCalledWith({
      supabase,
      storagePath: cleanupPath,
    })
  })

  it.each([
    ['document_conflict', 409],
    ['classroom_archived', 403],
    ['forbidden', 403],
    ['test_not_found', 404],
    ['Could not find the function update_test_documents_atomic', 503],
  ])('maps %s without falling back to a non-atomic write', async (message, status) => {
    const supabase = {
      rpc: vi.fn(async () => ({ data: null, error: { message } })),
    }

    const result = await updateTestDocumentsAtomic({
      supabase,
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedStatus: 'draft',
      expectedDocuments: [],
      proposedDocuments: [],
    })

    expect(result).toEqual(expect.objectContaining({ ok: false, status }))
    expect(removeQueuedTestDocumentSnapshotPath).not.toHaveBeenCalled()
  })
})
