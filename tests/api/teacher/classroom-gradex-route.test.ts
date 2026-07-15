import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createClassroomGradexExtract: vi.fn(),
  getServiceRoleClient: vi.fn(() => ({ client: true })),
  isExtractAllowed: vi.fn(() => true),
  isTriggerAllowed: vi.fn(() => true),
  requireRole: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireRole: mocks.requireRole }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: mocks.getServiceRoleClient }))
vi.mock('@/lib/server/classroom-gradex-operations', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/lib/server/classroom-gradex-operations')
  >()
  return {
    ...actual,
    createClassroomGradexExtract: mocks.createClassroomGradexExtract,
    isClassroomGradexExtractAllowed: mocks.isExtractAllowed,
    isClassroomGradexTriggerAllowed: mocks.isTriggerAllowed,
  }
})

import { POST } from '@/app/api/teacher/classrooms/[id]/archives/[archiveId]/gradex/route'

const CLASSROOM_ID = '10000000-0000-4000-8000-000000000001'
const ARCHIVE_ID = '20000000-0000-4000-8000-000000000001'
const OPERATION_ID = '30000000-0000-4000-8000-000000000001'
const TEACHER_ID = '40000000-0000-4000-8000-000000000001'
const DELETE_AFTER = '2026-08-01T12:00:00.000Z'

function context(
  id = CLASSROOM_ID,
  archiveId = ARCHIVE_ID,
) {
  return { params: Promise.resolve({ id, archiveId }) }
}

function request(options: {
  body?: string
  idempotencyKey?: string
} = {}) {
  return new NextRequest(
    `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/archives/${ARCHIVE_ID}/gradex`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.idempotencyKey === undefined
          ? { 'Idempotency-Key': OPERATION_ID }
          : options.idempotencyKey
            ? { 'Idempotency-Key': options.idempotencyKey }
            : {}),
      },
      body: options.body ?? JSON.stringify({ delete_after: DELETE_AFTER }),
    },
  )
}

describe('POST /api/teacher/classrooms/[id]/archives/[archiveId]/gradex', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-13T12:00:00.000Z'))
    mocks.requireRole.mockResolvedValue({ id: TEACHER_ID, role: 'teacher' })
    mocks.isExtractAllowed.mockReturnValue(true)
    mocks.isTriggerAllowed.mockReturnValue(true)
    mocks.createClassroomGradexExtract.mockResolvedValue({
      ok: true,
      status: 201,
      operation_id: OPERATION_ID,
      extract_id: OPERATION_ID,
      source_archive_id: ARCHIVE_ID,
      replayed: false,
      artifact_sha256: 'a'.repeat(64),
      content_sha256: 'b'.repeat(64),
      compressed_byte_size: 100,
      uncompressed_byte_size: 200,
      resource_counts: {},
      verification: {},
      generated_at: '2026-07-13T12:00:00.000Z',
      delete_after: DELETE_AFTER,
    })
  })

  it('delegates an allowlisted teacher request with explicit idempotency and retention', async () => {
    const response = await POST(request(), context())

    expect(response.status).toBe(201)
    expect(mocks.isTriggerAllowed).toHaveBeenCalledWith(ARCHIVE_ID)
    expect(mocks.createClassroomGradexExtract).toHaveBeenCalledWith({
      supabase: { client: true },
      operationId: OPERATION_ID,
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      sourceArchiveId: ARCHIVE_ID,
      deleteAfter: DELETE_AFTER,
    })
  })

  it('preserves structured coordinator failures and status codes', async () => {
    mocks.createClassroomGradexExtract.mockResolvedValue({
      ok: false,
      status: 404,
      operation_id: OPERATION_ID,
      error_code: 'classroom_archive_not_found',
      error: 'Verified source archive not found',
      retryable: false,
    })

    const response = await POST(request(), context())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      operation_id: OPERATION_ID,
      error_code: 'classroom_archive_not_found',
      retryable: false,
    }))
  })

  it('requires teacher authentication before checking canary configuration', async () => {
    const error = new Error('Not authenticated')
    error.name = 'AuthenticationError'
    mocks.requireRole.mockRejectedValue(error)

    const response = await POST(request(), context())
    expect(response.status).toBe(401)
    expect(mocks.isTriggerAllowed).not.toHaveBeenCalled()
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('fails closed when the archive-specific trigger canary is disabled', async () => {
    mocks.isTriggerAllowed.mockReturnValue(false)

    const response = await POST(request(), context())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      operation_id: OPERATION_ID,
      error_code: 'classroom_gradex_trigger_not_enabled',
      retryable: true,
    }))
    expect(mocks.isExtractAllowed).not.toHaveBeenCalled()
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('fails closed when the authenticated teacher is not in the coordinator canary', async () => {
    mocks.isExtractAllowed.mockReturnValue(false)

    const response = await POST(request(), context())
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      operation_id: OPERATION_ID,
      error_code: 'classroom_gradex_extract_not_enabled',
      retryable: true,
    }))
    expect(mocks.getServiceRoleClient).not.toHaveBeenCalled()
  })

  it('requires a caller-supplied UUID idempotency key', async () => {
    expect((await POST(request({ idempotencyKey: '' }), context())).status).toBe(400)
    expect((await POST(request({ idempotencyKey: 'not-a-uuid' }), context())).status).toBe(400)
    expect(mocks.createClassroomGradexExtract).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON, unexpected fields, and invalid route ids', async () => {
    expect((await POST(request({ body: '{' }), context())).status).toBe(400)
    expect((await POST(
      request({ body: JSON.stringify({ delete_after: DELETE_AFTER, force: true }) }),
      context(),
    )).status).toBe(400)
    expect((await POST(request(), context('not-a-uuid', ARCHIVE_ID))).status).toBe(400)
    expect((await POST(request(), context(CLASSROOM_ID, 'not-a-uuid'))).status).toBe(400)
    expect(mocks.createClassroomGradexExtract).not.toHaveBeenCalled()
  })

  it('rejects expired retention and retention beyond the 90-day contract', async () => {
    expect((await POST(
      request({ body: JSON.stringify({ delete_after: '2026-07-13T11:59:59.999Z' }) }),
      context(),
    )).status).toBe(400)
    expect((await POST(
      request({ body: JSON.stringify({ delete_after: '2026-10-12T12:00:00.001Z' }) }),
      context(),
    )).status).toBe(400)
    expect(mocks.createClassroomGradexExtract).not.toHaveBeenCalled()
  })
})
