import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import {
  GET as getImpact,
  POST as startPurge,
} from '@/app/api/teacher/course-blueprints/[id]/purge/route'
import { GET as getStatus } from '@/app/api/teacher/course-blueprints/[id]/purge/[operationId]/route'
import { POST as tickPurge } from '@/app/api/teacher/course-blueprints/[id]/purge/[operationId]/tick/route'

const TEACHER_ID = '10000000-0000-4000-8000-000000000201'
const BLUEPRINT_ID = '20000000-0000-4000-8000-000000000201'
const OPERATION_ID = '30000000-0000-4000-8000-000000000201'
const DIGEST = 'a'.repeat(64)

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  impact: vi.fn(),
  persistedImpact: vi.fn(),
  active: vi.fn(),
  start: vi.fn(),
  status: vi.fn(),
  tick: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireRole: (...args: unknown[]) => mocks.requireRole(...args),
}))
vi.mock('@/lib/server/course-blueprint-purge', () => ({
  getCourseBlueprintPurgeImpact: (...args: unknown[]) => mocks.impact(...args),
  getCourseBlueprintPurgeImpactForOperation: (...args: unknown[]) =>
    mocks.persistedImpact(...args),
  getActiveCourseBlueprintPurgeStatus: (...args: unknown[]) => mocks.active(...args),
  startCourseBlueprintPurge: (...args: unknown[]) => mocks.start(...args),
  getCourseBlueprintPurgeStatus: (...args: unknown[]) => mocks.status(...args),
  advanceCourseBlueprintPurge: (...args: unknown[]) => mocks.tick(...args),
}))

const impact = {
  course_blueprint_id: BLUEPRINT_ID,
  course_blueprint_title: 'Biology Blueprint',
}
const operation = {
  operation_id: OPERATION_ID,
  course_blueprint_id: BLUEPRINT_ID,
  status: 'deleting_objects',
  retryable: null,
  error_code: null,
  attempt_count: 1,
  resource_counts: { course_blueprints: 1 },
  storage_object_counts: { pending: 2 },
  completed_at: null,
}
const context = {
  params: Promise.resolve({ id: BLUEPRINT_ID, operationId: OPERATION_ID }),
} as never

describe('teacher Course Blueprint purge routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ id: TEACHER_ID })
    mocks.impact.mockResolvedValue(impact)
    mocks.persistedImpact.mockResolvedValue(impact)
    mocks.active.mockResolvedValue(null)
    mocks.start.mockResolvedValue(operation)
    mocks.status.mockResolvedValue(operation)
    mocks.tick.mockResolvedValue({ operation, advanced: true })
  })

  it('returns owner-scoped fresh impact when no deletion is active', async () => {
    const response = await getImpact(new NextRequest('http://localhost/purge'), context)
    expect(mocks.requireRole).toHaveBeenCalledWith('teacher')
    expect(mocks.impact).toHaveBeenCalledWith(TEACHER_ID, BLUEPRINT_ID)
    expect(await response.json()).toEqual({ impact, operation: null })
  })

  it('uses persisted impact when resuming instead of recomputing deleted files', async () => {
    mocks.active.mockResolvedValue(operation)
    const response = await getImpact(new NextRequest('http://localhost/purge'), context)

    expect(response.status).toBe(200)
    expect(mocks.persistedImpact).toHaveBeenCalledWith(
      TEACHER_ID,
      BLUEPRINT_ID,
      OPERATION_ID,
    )
    expect(mocks.impact).not.toHaveBeenCalled()
  })

  it('fails closed without a generic 500 before migration 120 exists', async () => {
    mocks.active.mockRejectedValue(new ApiError(
      503,
      'Permanent Course Blueprint deletion is not available yet',
    ))
    const response = await getImpact(new NextRequest('http://localhost/purge'), context)

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      error: 'Permanent Course Blueprint deletion is not available yet',
    })
    expect(mocks.impact).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('passes typed confirmation and exact inventory identity to the coordinator', async () => {
    const response = await startPurge(new NextRequest('http://localhost/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_id: OPERATION_ID,
        confirmation: 'Biology Blueprint',
        expected_source_revision: 7,
        expected_inventory_sha256: DIGEST,
      }),
    }), context)
    expect(mocks.start).toHaveBeenCalledWith({
      teacherId: TEACHER_ID,
      courseBlueprintId: BLUEPRINT_ID,
      operationId: OPERATION_ID,
      confirmation: 'Biology Blueprint',
      expectedSourceRevision: 7,
      expectedInventorySha256: DIGEST,
    })
    expect(response.status).toBe(202)
  })

  it('binds status and retry ticks to teacher and Blueprint', async () => {
    expect((await getStatus(new NextRequest('http://localhost/status'), context)).status)
      .toBe(200)
    expect((await tickPurge(
      new NextRequest('http://localhost/tick', { method: 'POST' }),
      context,
    )).status).toBe(202)
    expect(mocks.status).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
    expect(mocks.tick).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
  })

  it('rejects students before reading or mutating purge state', async () => {
    const error = new Error('Forbidden')
    error.name = 'AuthorizationError'
    mocks.requireRole.mockRejectedValue(error)
    const response = await startPurge(new NextRequest('http://localhost/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_id: OPERATION_ID,
        confirmation: 'DELETE',
        expected_source_revision: 7,
        expected_inventory_sha256: DIGEST,
      }),
    }), context)
    expect(response.status).toBe(403)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('does not tick an operation through a different Blueprint URL', async () => {
    const otherBlueprintId = '40000000-0000-4000-8000-000000000201'
    const response = await tickPurge(
      new NextRequest('http://localhost/tick', { method: 'POST' }),
      {
        params: Promise.resolve({
          id: otherBlueprintId,
          operationId: OPERATION_ID,
        }),
      } as never,
    )
    expect(response.status).toBe(404)
    expect(mocks.tick).not.toHaveBeenCalled()
  })
})
