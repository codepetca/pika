import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/teacher/tests/[id]/documents/[docId]/sync/route'
import { ApiError } from '@/lib/api-handler'
import {
  syncExternalLinkTestDocument,
} from '@/lib/server/test-document-snapshots'
import {
  removeQueuedTestDocumentSnapshotPath,
} from '@/lib/server/test-document-snapshot-storage-cleanup'

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
    test: {
      id: 'test-1',
      classroom_id: 'classroom-1',
      title: 'Unit Test',
      status: 'draft',
      show_results: false,
      position: 0,
      created_at: '2026-04-02T00:00:00.000Z',
      updated_at: '2026-04-02T00:00:00.000Z',
      documents: [
        {
          id: 'doc-1',
          title: 'Node.js API',
          source: 'link',
          url: 'https://nodejs.org/api/fs.html',
        },
      ],
      classrooms: { archived_at: null },
    },
  })),
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: vi.fn(() => mockSupabase),
}))

vi.mock('@/lib/server/test-document-snapshots', () => ({
  findTestDocument: (
    test: { documents?: Array<{ id?: string }> },
    docId: string,
  ) => test.documents?.find((document) => document.id === docId) || null,
  syncExternalLinkTestDocument: vi.fn(),
}))

vi.mock('@/lib/server/test-document-snapshot-storage-cleanup', () => ({
  removeQueuedTestDocumentSnapshotPath: vi.fn(),
}))

const mockRpc = vi.fn()
const mockSupabase = {
  rpc: mockRpc,
}

describe('POST /api/teacher/tests/[id]/documents/[docId]/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(syncExternalLinkTestDocument).mockResolvedValue({
      snapshot_content_type: 'text/html',
      snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshots/new',
      synced_at: '2026-07-23T14:00:00.000Z',
    })
    vi.mocked(removeQueuedTestDocumentSnapshotPath).mockResolvedValue({
      completed: true,
    })
    mockRpc.mockResolvedValue({
      data: {
        previous_snapshot_path: null,
        test: {
          id: 'test-1',
          documents: [{
            id: 'doc-1',
            title: 'Node.js API',
            source: 'link',
            url: 'https://nodejs.org/api/fs.html',
            snapshot_content_type: 'text/html',
            snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshots/new',
            synced_at: '2026-07-23T14:00:00.000Z',
          }],
        },
      },
      error: null,
    })
  })

  it('syncs a link document and saves snapshot metadata', async () => {
    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/documents/doc-1/sync', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(syncExternalLinkTestDocument).toHaveBeenCalledWith({
      doc: expect.objectContaining({
        id: 'doc-1',
        url: 'https://nodejs.org/api/fs.html',
      }),
      teacherId: 'teacher-1',
      testId: 'test-1',
    })
    expect(mockRpc).toHaveBeenCalledWith(
      'sync_test_document_snapshot_atomic',
      {
        p_document_id: 'doc-1',
        p_expected_url: 'https://nodejs.org/api/fs.html',
        p_snapshot_content_type: 'text/html',
        p_snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshots/new',
        p_synced_at: '2026-07-23T14:00:00.000Z',
        p_teacher_id: 'teacher-1',
        p_test_id: 'test-1',
      },
    )
    expect(data.doc.snapshot_path).toBe(
      'link-docs/teacher-1/test-1/doc-1/snapshots/new',
    )
    expect(data.doc.snapshot_content_type).toBe('text/html')
    expect(data.doc.synced_at).toBeTruthy()
  })

  it('returns 400 for unsupported source types', async () => {
    vi.mocked(syncExternalLinkTestDocument).mockRejectedValue(
      new ApiError(400, 'Unsupported document type'),
    )

    const response = await POST(
      new NextRequest('http://localhost:3000/api/teacher/tests/test-1/documents/doc-1/sync', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) }
    )
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data.error).toBe('Unsupported document type')
  })

  it.each([
    ['concurrent edit or removal', 'document_conflict', 409],
    ['cleanup lease acquisition', 'snapshot_cleanup_in_progress', 409],
    ['missing cleanup evidence', 'snapshot_cleanup_evidence_missing', 409],
    ['classroom archive', 'classroom_archived', 403],
    ['ownership loss', 'forbidden', 403],
  ])(
    'removes the uncommitted snapshot after %s',
    async (_scenario, message, expectedStatus) => {
      mockRpc.mockResolvedValue({
        data: null,
        error: { message },
      })

      const response = await POST(
        new NextRequest(
          'http://localhost:3000/api/teacher/tests/test-1/documents/doc-1/sync',
          { method: 'POST' },
        ),
        { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) },
      )

      expect(response.status).toBe(expectedStatus)
      expect(removeQueuedTestDocumentSnapshotPath).toHaveBeenCalledWith({
        supabase: mockSupabase,
        storagePath: 'link-docs/teacher-1/test-1/doc-1/snapshots/new',
      })
    },
  )

  it('removes the exact superseded snapshot returned by the atomic write', async () => {
    mockRpc.mockResolvedValue({
      data: {
        previous_snapshot_path:
          'link-docs/teacher-1/test-1/doc-1/snapshots/previous',
        test: {
          id: 'test-1',
          documents: [{
            id: 'doc-1',
            title: 'Node.js API',
            source: 'link',
            url: 'https://nodejs.org/api/fs.html',
            snapshot_content_type: 'text/html',
            snapshot_path: 'link-docs/teacher-1/test-1/doc-1/snapshots/new',
            synced_at: '2026-07-23T14:00:00.000Z',
          }],
        },
      },
      error: null,
    })

    const response = await POST(
      new NextRequest(
        'http://localhost:3000/api/teacher/tests/test-1/documents/doc-1/sync',
        { method: 'POST' },
      ),
      { params: Promise.resolve({ id: 'test-1', docId: 'doc-1' }) },
    )

    expect(response.status).toBe(200)
    expect(removeQueuedTestDocumentSnapshotPath).toHaveBeenCalledWith({
      supabase: mockSupabase,
      storagePath: 'link-docs/teacher-1/test-1/doc-1/snapshots/previous',
    })
  })
})
