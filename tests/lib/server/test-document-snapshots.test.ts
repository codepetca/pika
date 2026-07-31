import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_DOCUMENT_MAX_SIZE } from '@/lib/test-documents'
import { fetchSafeExternalDocument } from '@/lib/server/safe-external-document'
import { syncExternalLinkTestDocument } from '@/lib/server/test-document-snapshots'
const mockUpload = vi.fn()
const CLASSROOM_ID = '10000000-0000-4000-8000-000000000010'
const NOW = '2026-07-31T12:00:00.000Z'
const mockRpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({
  data: {
    id: args.p_object_id,
    storage_bucket: 'test-documents',
    storage_path: name === 'begin_managed_storage_upload'
      ? args.p_storage_path
      : `classrooms/${CLASSROOM_ID}/tests/test-1/documents/doc-1/snapshots/${args.p_object_id}`,
    classroom_id: CLASSROOM_ID,
    course_blueprint_id: null,
    purpose: 'test_execution_snapshot',
    status: name === 'begin_managed_storage_upload' ? 'pending_upload' : 'ready',
    created_by_user_id: null,
    data_subject_user_id: null,
    resource_type: 'test',
    resource_id: null,
    content_type: 'text/html',
    byte_size: 100,
    content_sha256: null,
    upload_expires_at: null,
    attempt_count: 0,
    next_attempt_at: NOW,
    lease_token: null,
    lease_expires_at: null,
    last_error_code: null,
    created_at: NOW,
    ready_at: name === 'begin_managed_storage_upload' ? null : NOW,
    updated_at: NOW,
  },
  error: null,
}))
const mockSupabase = {
  rpc: mockRpc,
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
    mockRpc.mockClear()
  })

  it('uses the safe fetch boundary and stores a unique immutable snapshot', async () => {
    const result = await syncExternalLinkTestDocument({
      teacherId: 'teacher-1',
      classroomId: CLASSROOM_ID,
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
        new RegExp(`^classrooms/${CLASSROOM_ID}/tests/test-1/documents/doc-1/snapshots/[0-9a-f-]+$`),
      ),
      expect.any(Buffer),
      {
        contentType: 'text/html',
        upsert: false,
      },
    )
    expect(mockRpc).toHaveBeenCalledWith(
      'begin_managed_storage_upload',
      expect.objectContaining({
        p_classroom_id: CLASSROOM_ID,
        p_purpose: 'test_execution_snapshot',
      }),
    )
    const uploadedBody = mockUpload.mock.calls[0][1] as Buffer
    expect(uploadedBody.toString('utf8')).not.toContain('<script>')
    expect(uploadedBody.toString('utf8')).toContain(
      '<base href="https://docs.example.com/final">',
    )
    expect(result.snapshot_path).toMatch(
      new RegExp(`^classrooms/${CLASSROOM_ID}/tests/test-1/documents/doc-1/snapshots/[0-9a-f-]+$`),
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
        classroomId: CLASSROOM_ID,
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

  it('does not upload without a durable managed ownership reservation', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'begin_managed_storage_upload is unavailable' },
    })

    await expect(
      syncExternalLinkTestDocument({
        teacherId: 'teacher-1',
        classroomId: CLASSROOM_ID,
        testId: 'test-1',
        doc: {
          id: 'doc-1',
          title: 'Reference',
          source: 'link',
          url: 'https://docs.example.com/data',
        },
      }),
    ).rejects.toThrow('migration 117')

    expect(mockUpload).not.toHaveBeenCalled()
  })
})
