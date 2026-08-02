import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co')
    vi.mocked(removeQueuedTestDocumentSnapshotPath).mockResolvedValue({
      completed: true,
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
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
      'update_test_documents_managed_atomic',
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
        p_expected_managed_storage_claims: [],
        p_managed_storage_claims: [],
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
    ['Could not find the function update_test_documents_managed_atomic', 503],
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

  it('submits client-visible upload IDs only as exact ownership claims', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'managed_test_document_owner_mismatch' },
    }))

    const result = await updateTestDocumentsAtomic({
      supabase: { rpc },
      teacherId: 'teacher-1',
      testId: 'test-1',
      expectedStatus: 'draft',
      expectedDocuments: [],
      proposedDocuments: [{
        id: 'doc-1',
        title: 'Uploaded notes',
        source: 'upload',
        url: 'https://project.supabase.co/storage/v1/object/public/test-documents/classrooms/classroom-foreign/tests/test-foreign/materials/object.pdf',
        managed_object_id: '00000000-0000-4000-8000-000000000001',
      }],
    })

    expect(result).toEqual(expect.objectContaining({ ok: false, status: 409 }))
    expect(rpc).toHaveBeenCalledWith(
      'update_test_documents_managed_atomic',
      expect.objectContaining({
        p_managed_storage_claims: [{
          document_id: 'doc-1',
          reference_kind: 'teacher_upload',
          managed_object_id: '00000000-0000-4000-8000-000000000001',
          storage_bucket: 'test-documents',
          storage_path: 'classrooms/classroom-foreign/tests/test-foreign/materials/object.pdf',
          purpose: 'teacher_test_material',
        }],
        p_expected_managed_storage_claims: [],
      }),
    )
  })

  it('submits removed upload ownership to the same atomic update', async () => {
    const objectId = '00000000-0000-4000-8000-000000000001'
    const storagePath = 'classrooms/classroom-1/tests/test-1/materials/object.pdf'
    const rpc = vi.fn(async () => ({
      data: {
        cleanup_paths: [],
        test: { id: 'test-1', classroom_id: 'classroom-1', documents: [] },
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
        title: 'Uploaded notes',
        source: 'upload',
        url: `https://project.supabase.co/storage/v1/object/public/test-documents/${storagePath}`,
        managed_object_id: objectId,
      }],
      proposedDocuments: [],
    })

    expect(result.ok).toBe(true)
    expect(rpc).toHaveBeenCalledWith(
      'update_test_documents_managed_atomic',
      expect.objectContaining({
        p_managed_storage_claims: [],
        p_expected_managed_storage_claims: [{
          document_id: 'doc-1',
          reference_kind: 'teacher_upload',
          managed_object_id: objectId,
          storage_bucket: 'test-documents',
          storage_path: storagePath,
          purpose: 'teacher_test_material',
        }],
      }),
    )
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
