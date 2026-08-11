import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as getImpact, POST as startPurge } from '@/app/api/teacher/classrooms/[id]/archives/[archiveId]/purge/route'
import { GET as getStatus } from '@/app/api/teacher/classrooms/[id]/archives/[archiveId]/purge/[operationId]/route'
import { POST as tickPurge } from '@/app/api/teacher/classrooms/[id]/archives/[archiveId]/purge/[operationId]/tick/route'
import { ApiError } from '@/lib/api-error'

const TEACHER_ID = '10000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '20000000-0000-4000-8000-000000000001'
const ARCHIVE_ID = '30000000-0000-4000-8000-000000000001'
const OPERATION_ID = '40000000-0000-4000-8000-000000000001'
const DIGEST = 'a'.repeat(64)

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  impact: vi.fn(),
  active: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  tick: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: (...args: unknown[]) => mocks.requireRole(...args),
}))
vi.mock('@/lib/server/cold-classroom-purge', () => ({
  getColdClassroomPurgeImpact: (...args: unknown[]) => mocks.impact(...args),
  getActiveColdClassroomPurgeStatus: (...args: unknown[]) => mocks.active(...args),
  startColdClassroomPurge: (...args: unknown[]) => mocks.start(...args),
  getColdClassroomPurgeStatus: (...args: unknown[]) => mocks.status(...args),
  advanceColdClassroomPurge: (...args: unknown[]) => mocks.tick(...args),
}))

const impact = {
  classroom_id: CLASSROOM_ID,
  archive_id: ARCHIVE_ID,
  classroom_title: 'Stored Biology',
}
const operation = {
  operation_id: OPERATION_ID,
  classroom_id: CLASSROOM_ID,
  status: 'deleting_objects',
  retryable: null,
  error_code: null,
  attempt_count: 1,
  resource_counts: { classroom_cold_tombstones: 1 },
  storage_object_counts: { pending: 2 },
  completed_at: null,
}
const context = {
  params: Promise.resolve({
    id: CLASSROOM_ID,
    archiveId: ARCHIVE_ID,
    operationId: OPERATION_ID,
  }),
} as never

describe('teacher cold classroom purge routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ id: TEACHER_ID })
    mocks.impact.mockResolvedValue(impact)
    mocks.active.mockResolvedValue(null)
    mocks.start.mockResolvedValue(operation)
    mocks.status.mockResolvedValue(operation)
    mocks.tick.mockResolvedValue({ operation, advanced: true })
  })

  it('returns impact and resumable state bound to teacher, classroom, and archive', async () => {
    mocks.active.mockResolvedValue(operation)
    const response = await getImpact(new NextRequest('http://localhost/purge'), context)

    expect(mocks.requireRole).toHaveBeenCalledWith('teacher')
    expect(mocks.impact).toHaveBeenCalledWith(TEACHER_ID, CLASSROOM_ID, ARCHIVE_ID)
    expect(mocks.active).toHaveBeenCalledWith(TEACHER_ID, CLASSROOM_ID, ARCHIVE_ID)
    await expect(response.json()).resolves.toEqual({ impact, operation })
  })

  it('passes exact archive identity, typed confirmation, and both inventory digests', async () => {
    const response = await startPurge(new NextRequest('http://localhost/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_id: OPERATION_ID,
        confirmation: 'DELETE STORED ARCHIVE',
        expected_source_revision: 8,
        expected_storage_inventory_sha256: DIGEST,
        expected_cold_resource_inventory_sha256: DIGEST,
      }),
    }), context)

    expect(mocks.start).toHaveBeenCalledWith({
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      archiveId: ARCHIVE_ID,
      operationId: OPERATION_ID,
      confirmation: 'DELETE STORED ARCHIVE',
      expectedSourceRevision: 8,
      expectedStorageInventorySha256: DIGEST,
      expectedColdResourceInventorySha256: DIGEST,
    })
    expect(response.status).toBe(202)
  })

  it('authorizes and validates URL ownership before advancing a tick', async () => {
    const statusResponse = await getStatus(new NextRequest('http://localhost/status'), context)
    const tickResponse = await tickPurge(new NextRequest('http://localhost/tick', {
      method: 'POST',
    }), context)

    expect(statusResponse.status).toBe(200)
    expect(tickResponse.status).toBe(202)
    expect(mocks.status).toHaveBeenNthCalledWith(
      1,
      TEACHER_ID,
      CLASSROOM_ID,
      ARCHIVE_ID,
      OPERATION_ID,
    )
    expect(mocks.status).toHaveBeenNthCalledWith(
      2,
      TEACHER_ID,
      CLASSROOM_ID,
      ARCHIVE_ID,
      OPERATION_ID,
    )
    expect(mocks.tick).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
  })

  it('rejects students before reading or mutating cold purge state', async () => {
    const error = new Error('Forbidden')
    error.name = 'AuthorizationError'
    mocks.requireRole.mockRejectedValue(error)

    const response = await startPurge(new NextRequest('http://localhost/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_id: OPERATION_ID,
        confirmation: 'DELETE STORED ARCHIVE',
        expected_source_revision: 8,
        expected_storage_inventory_sha256: DIGEST,
        expected_cold_resource_inventory_sha256: DIGEST,
      }),
    }), context)

    expect(response.status).toBe(403)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('rejects malformed or non-empty tick bodies without advancing', async () => {
    const invalidJson = await tickPurge(new NextRequest('http://localhost/tick', {
      method: 'POST',
      body: '{',
    }), context)
    const unexpectedField = await tickPurge(new NextRequest('http://localhost/tick', {
      method: 'POST',
      body: JSON.stringify({ classroom_id: CLASSROOM_ID }),
    }), context)

    expect(invalidJson.status).toBe(400)
    expect(unexpectedField.status).toBe(400)
    expect(mocks.status).not.toHaveBeenCalled()
    expect(mocks.tick).not.toHaveBeenCalled()
  })

  it('does not advance when URL ownership validation fails', async () => {
    const error = new ApiError(404, 'Stored classroom deletion not found')
    mocks.status.mockRejectedValue(error)

    const response = await tickPurge(new NextRequest('http://localhost/tick', {
      method: 'POST',
    }), context)

    expect(response.status).toBe(404)
    expect(mocks.tick).not.toHaveBeenCalled()
  })
})
