import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as getImpact, POST as startPurge } from '@/app/api/teacher/classrooms/[id]/purge/route'
import { GET as getStatus } from '@/app/api/teacher/classrooms/[id]/purge/[operationId]/route'
import { POST as tickPurge } from '@/app/api/teacher/classrooms/[id]/purge/[operationId]/tick/route'

const TEACHER_ID = '10000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '20000000-0000-4000-8000-000000000001'
const OPERATION_ID = '30000000-0000-4000-8000-000000000001'
const DIGEST = 'a'.repeat(64)

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), impact: vi.fn(), active: vi.fn(),
  start: vi.fn(), status: vi.fn(), tick: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRole: (...args: unknown[]) => mocks.requireRole(...args) }))
vi.mock('@/lib/server/classroom-purge', () => ({
  getClassroomPurgeImpact: (...args: unknown[]) => mocks.impact(...args),
  getActiveClassroomPurgeStatus: (...args: unknown[]) => mocks.active(...args),
  startClassroomPurge: (...args: unknown[]) => mocks.start(...args),
  getClassroomPurgeStatus: (...args: unknown[]) => mocks.status(...args),
  advanceClassroomPurge: (...args: unknown[]) => mocks.tick(...args),
}))

const impact = { classroom_id: CLASSROOM_ID, classroom_title: 'Archived Biology' }
const operation = {
  operation_id: OPERATION_ID, classroom_id: CLASSROOM_ID,
  status: 'deleting_objects', retryable: null, error_code: null,
  attempt_count: 1, resource_counts: { classrooms: 1 },
  storage_object_counts: { pending: 2 }, completed_at: null,
}
const context = { params: Promise.resolve({ id: CLASSROOM_ID, operationId: OPERATION_ID }) } as never

describe('teacher classroom purge routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ id: TEACHER_ID })
    mocks.impact.mockResolvedValue(impact)
    mocks.active.mockResolvedValue(null)
    mocks.start.mockResolvedValue(operation)
    mocks.status.mockResolvedValue(operation)
    mocks.tick.mockResolvedValue({ operation, advanced: true })
  })

  it('returns owner-scoped impact and resumable state', async () => {
    mocks.active.mockResolvedValue(operation)
    const response = await getImpact(new NextRequest('http://localhost/purge'), context)
    expect(mocks.requireRole).toHaveBeenCalledWith('teacher')
    expect(mocks.impact).toHaveBeenCalledWith(TEACHER_ID, CLASSROOM_ID)
    expect(await response.json()).toEqual({ impact, operation })
  })

  it('passes typed confirmation and inventory identity to the coordinator', async () => {
    const response = await startPurge(new NextRequest('http://localhost/purge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_id: OPERATION_ID,
        confirmation: 'Archived Biology',
        expected_source_revision: 7,
        expected_storage_inventory_sha256: DIGEST,
        expected_operational_inventory_sha256: DIGEST,
      }),
    }), context)
    expect(mocks.start).toHaveBeenCalledWith({
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      operationId: OPERATION_ID,
      confirmation: 'Archived Biology',
      expectedSourceRevision: 7,
      expectedStorageInventorySha256: DIGEST,
      expectedOperationalInventorySha256: DIGEST,
    })
    expect(response.status).toBe(202)
  })

  it('binds status and retry ticks to teacher and classroom', async () => {
    expect((await getStatus(new NextRequest('http://localhost/status'), context)).status).toBe(200)
    expect((await tickPurge(new NextRequest('http://localhost/tick', { method: 'POST' }), context)).status).toBe(202)
    expect(mocks.status).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
    expect(mocks.tick).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
    await expect((await tickPurge(
      new NextRequest('http://localhost/tick', { method: 'POST' }), context,
    )).json()).resolves.toMatchObject({ advanced: true })
  })

  it('rejects students before reading or mutating purge state', async () => {
    const error = new Error('Forbidden')
    error.name = 'AuthorizationError'
    mocks.requireRole.mockRejectedValue(error)
    const response = await startPurge(new NextRequest('http://localhost/purge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_id: OPERATION_ID,
        confirmation: 'DELETE',
        expected_source_revision: 7,
        expected_storage_inventory_sha256: DIGEST,
        expected_operational_inventory_sha256: DIGEST,
      }),
    }), context)
    expect(response.status).toBe(403)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('does not tick an operation through a different classroom URL', async () => {
    const otherClassroomId = '40000000-0000-4000-8000-000000000001'
    const response = await tickPurge(new NextRequest('http://localhost/tick', { method: 'POST' }), {
      params: Promise.resolve({ id: otherClassroomId, operationId: OPERATION_ID }),
    } as never)
    expect(response.status).toBe(404)
    expect(mocks.tick).not.toHaveBeenCalled()
  })
})
