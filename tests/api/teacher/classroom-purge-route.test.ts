import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  GET as getImpact,
  POST as startPurge,
} from '@/app/api/teacher/classrooms/[id]/purge/route'
import { GET as getStatus } from '@/app/api/teacher/classrooms/[id]/purge/[operationId]/route'
import { POST as tickPurge } from '@/app/api/teacher/classrooms/[id]/purge/[operationId]/tick/route'

const TEACHER_ID = '10000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '20000000-0000-4000-8000-000000000001'
const OPERATION_ID = '30000000-0000-4000-8000-000000000001'

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

vi.mock('@/lib/server/classroom-purge', () => ({
  getClassroomPurgeImpact: (...args: unknown[]) => mocks.impact(...args),
  getActiveClassroomPurgeStatus: (...args: unknown[]) => mocks.active(...args),
  startClassroomPurge: (...args: unknown[]) => mocks.start(...args),
  getClassroomPurgeStatus: (...args: unknown[]) => mocks.status(...args),
  tickClassroomPurge: (...args: unknown[]) => mocks.tick(...args),
}))

const impact = {
  classroom_id: CLASSROOM_ID,
  classroom_title: 'Archived Biology',
  relational_row_count: 10,
  student_count: 2,
  managed_file_count: 3,
  managed_file_bytes: 1200,
  missing_file_count: 0,
  archive_count: 1,
  gradex_extract_count: 0,
  resource_counts: { classrooms: 1 },
  storage_counts: { 'assignment-artifacts': 2, 'classroom-archives': 1 },
  conflicting_operation: null,
}

const operation = {
  operation_id: OPERATION_ID,
  classroom_id: CLASSROOM_ID,
  status: 'deleting_objects',
  retryable: null,
  error_code: null,
  resource_counts: { classrooms: 1 },
  storage_object_counts: { pending: 2, deleted: 1 },
  completed_at: null,
}

const context = {
  params: Promise.resolve({
    id: CLASSROOM_ID,
    operationId: OPERATION_ID,
  }),
} as never

describe('teacher classroom purge routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ id: TEACHER_ID })
    mocks.impact.mockResolvedValue(impact)
    mocks.active.mockResolvedValue(null)
    mocks.start.mockResolvedValue(operation)
    mocks.status.mockResolvedValue(operation)
    mocks.tick.mockResolvedValue(operation)
  })

  it('returns an owner-scoped impact summary and resumable operation', async () => {
    mocks.active.mockResolvedValue(operation)
    const response = await getImpact(
      new NextRequest(`http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/purge`),
      context,
    )

    expect(mocks.requireRole).toHaveBeenCalledWith('teacher')
    expect(mocks.impact).toHaveBeenCalledWith(TEACHER_ID, CLASSROOM_ID)
    expect(mocks.active).toHaveBeenCalledWith(TEACHER_ID, CLASSROOM_ID)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ impact, operation })
  })

  it('passes typed confirmation and idempotency identity to the coordinator', async () => {
    const response = await startPurge(
      new NextRequest(
        `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/purge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation_id: OPERATION_ID,
            confirmation: 'Archived Biology',
          }),
        },
      ),
      context,
    )

    expect(mocks.start).toHaveBeenCalledWith({
      teacherId: TEACHER_ID,
      classroomId: CLASSROOM_ID,
      operationId: OPERATION_ID,
      confirmation: 'Archived Biology',
    })
    expect(response.status).toBe(202)
  })

  it('binds status and retry ticks to the authenticated teacher and classroom', async () => {
    const statusResponse = await getStatus(
      new NextRequest(
        `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/purge/${OPERATION_ID}`,
      ),
      context,
    )
    const tickResponse = await tickPurge(
      new NextRequest(
        `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/purge/${OPERATION_ID}/tick`,
        { method: 'POST' },
      ),
      context,
    )

    expect(mocks.status).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
    expect(mocks.tick).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
    expect(statusResponse.status).toBe(200)
    expect(tickResponse.status).toBe(202)
  })

  it('rejects students before reading or mutating purge state', async () => {
    const error = new Error('Forbidden')
    error.name = 'AuthorizationError'
    mocks.requireRole.mockRejectedValue(error)

    const response = await startPurge(
      new NextRequest(
        `http://localhost/api/teacher/classrooms/${CLASSROOM_ID}/purge`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            operation_id: OPERATION_ID,
            confirmation: 'DELETE',
          }),
        },
      ),
      context,
    )

    expect(response.status).toBe(403)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('does not expose an operation through a different classroom URL', async () => {
    const response = await getStatus(
      new NextRequest(
        'http://localhost/api/teacher/classrooms/40000000-0000-4000-8000-000000000001/purge/'
          + OPERATION_ID,
      ),
      {
        params: Promise.resolve({
          id: '40000000-0000-4000-8000-000000000001',
          operationId: OPERATION_ID,
        }),
      } as never,
    )

    expect(response.status).toBe(404)
  })
})
