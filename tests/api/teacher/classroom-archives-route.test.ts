import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  exportClassroomArchive: vi.fn(),
  getServiceRoleClient: vi.fn(() => ({ client: true })),
  isExportAllowed: vi.fn(() => true),
  requireRole: vi.fn(),
  resolveSourceCommit: vi.fn(() => 'abcdef1234567890'),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: mocks.requireRole,
}))

vi.mock('@/lib/supabase', () => ({
  getServiceRoleClient: mocks.getServiceRoleClient,
}))

vi.mock('@/lib/server/classroom-archive-operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-archive-operations')>()
  return {
    ...actual,
    exportClassroomArchive: mocks.exportClassroomArchive,
    isClassroomArchiveExportAllowed: mocks.isExportAllowed,
    resolveClassroomArchiveSourceCommit: mocks.resolveSourceCommit,
  }
})

import { POST } from '@/app/api/teacher/classrooms/[id]/archives/route'

const CLASSROOM_ID = '00000000-0000-4000-8000-000000000001'
const OPERATION_ID = '00000000-0000-4000-8000-000000000002'

function context(id = CLASSROOM_ID) {
  return { params: Promise.resolve({ id }) }
}

describe('POST /api/teacher/classrooms/[id]/archives', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
    mocks.requireRole.mockResolvedValue({ id: 'teacher-1', role: 'teacher' })
    mocks.resolveSourceCommit.mockReturnValue('abcdef1234567890')
    mocks.isExportAllowed.mockReturnValue(true)
    mocks.exportClassroomArchive.mockResolvedValue({
      ok: true,
      status: 201,
      operation_id: OPERATION_ID,
      archive_id: OPERATION_ID,
      replayed: false,
      artifact_sha256: 'a'.repeat(64),
      content_sha256: 'b'.repeat(64),
      compressed_byte_size: 100,
      uncompressed_byte_size: 200,
      resource_counts: { classrooms: 1 },
      storage_object_counts: { total_count: 0, total_bytes: 0 },
      verification: {
        read_back_verified: true,
        artifact_checksum_verified: true,
        manifest_verified: true,
        resource_checksums_verified: true,
        resource_counts_verified: true,
        storage_objects_verified: true,
        actor_snapshots_verified: true,
        verified_at: '2026-07-13T12:00:00.000Z',
      },
    })
  })

  it('starts a teacher-managed export with a caller idempotency key', async () => {
    const request = new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives`, {
      method: 'POST',
      headers: { 'Idempotency-Key': OPERATION_ID },
    })
    const response = await POST(request, context())

    expect(response.status).toBe(201)
    expect(mocks.exportClassroomArchive).toHaveBeenCalledWith({
      supabase: { client: true },
      operationId: OPERATION_ID,
      teacherId: 'teacher-1',
      classroomId: CLASSROOM_ID,
      retention: { mode: 'teacher_managed', delete_after: null },
      sourceAppCommit: 'abcdef1234567890',
      supabaseUrl: 'https://project.supabase.co',
    })
  })

  it('accepts a finite scheduled retention policy', async () => {
    const deleteAfter = new Date(Date.now() + 86_400_000).toISOString()
    const request = new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': OPERATION_ID,
      },
      body: JSON.stringify({ retention: { mode: 'scheduled', delete_after: deleteAfter } }),
    })
    await POST(request, context())

    expect(mocks.exportClassroomArchive).toHaveBeenCalledWith(expect.objectContaining({
      retention: { mode: 'scheduled', delete_after: deleteAfter },
    }))
  })

  it('rejects an expired scheduled retention policy before export', async () => {
    const request = new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': OPERATION_ID,
      },
      body: JSON.stringify({
        retention: { mode: 'scheduled', delete_after: '2020-01-01T00:00:00.000Z' },
      }),
    })

    expect((await POST(request, context())).status).toBe(400)
    expect(mocks.exportClassroomArchive).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON and invalid idempotency keys before export', async () => {
    const malformed = new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    expect((await POST(malformed, context())).status).toBe(400)

    const invalidKey = new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'not-a-uuid' },
    })
    expect((await POST(invalidKey, context())).status).toBe(400)
    expect(mocks.exportClassroomArchive).not.toHaveBeenCalled()
  })

  it('fails closed when the deployed commit is unavailable', async () => {
    mocks.resolveSourceCommit.mockImplementation(() => {
      throw new Error('missing')
    })
    const request = new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives`, {
      method: 'POST',
      headers: { 'Idempotency-Key': OPERATION_ID },
    })
    const response = await POST(request, context())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error_code: 'archive_source_version_unavailable',
      operation_id: OPERATION_ID,
      retryable: true,
    }))
    expect(mocks.exportClassroomArchive).not.toHaveBeenCalled()
  })

  it('fails closed when the teacher is not in the export canary', async () => {
    mocks.isExportAllowed.mockReturnValue(false)
    const request = new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives`, {
      method: 'POST',
      headers: { 'Idempotency-Key': OPERATION_ID },
    })
    const response = await POST(request, context())

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      error_code: 'classroom_archive_export_not_enabled',
      operation_id: OPERATION_ID,
      retryable: true,
    }))
    expect(mocks.resolveSourceCommit).not.toHaveBeenCalled()
    expect(mocks.exportClassroomArchive).not.toHaveBeenCalled()
  })
})
