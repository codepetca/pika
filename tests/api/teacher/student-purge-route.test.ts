import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-error'
import { GET as getImpact, POST as startPurge } from '@/app/api/teacher/classrooms/[id]/students/[studentId]/purge/route'
import { GET as getStatus } from '@/app/api/teacher/classrooms/[id]/students/[studentId]/purge/[operationId]/route'
import { POST as tickPurge } from '@/app/api/teacher/classrooms/[id]/students/[studentId]/purge/[operationId]/tick/route'

const TEACHER_ID = '10000000-0000-4000-8000-000000000001'
const CLASSROOM_ID = '20000000-0000-4000-8000-000000000001'
const STUDENT_ID = '30000000-0000-4000-8000-000000000001'
const OPERATION_ID = '40000000-0000-4000-8000-000000000001'
const DIGEST = 'a'.repeat(64)

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(), impact: vi.fn(), active: vi.fn(), start: vi.fn(), status: vi.fn(), tick: vi.fn(), target: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ requireRole: (...args: unknown[]) => mocks.requireRole(...args) }))
vi.mock('@/lib/server/student-purge', () => ({
  getStudentPurgeImpact: (...args: unknown[]) => mocks.impact(...args),
  getActiveStudentPurgeStatus: (...args: unknown[]) => mocks.active(...args),
  startStudentPurge: (...args: unknown[]) => mocks.start(...args),
  getStudentPurgeStatus: (...args: unknown[]) => mocks.status(...args),
  advanceStudentPurge: (...args: unknown[]) => mocks.tick(...args),
  assertStudentPurgeOperationTarget: (...args: unknown[]) => mocks.target(...args),
}))

const impact = { classroom_id: CLASSROOM_ID, student_id: STUDENT_ID }
const operation = {
  operation_id: OPERATION_ID, classroom_id: CLASSROOM_ID,
  status: 'deleting_objects', retryable: null, error_code: null,
  attempt_count: 1, resource_counts: {}, storage_object_counts: { pending: 1 }, completed_at: null,
}
const context = { params: Promise.resolve({
  id: CLASSROOM_ID, studentId: STUDENT_ID, operationId: OPERATION_ID,
}) } as never

describe('teacher individual-student purge routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireRole.mockResolvedValue({ id: TEACHER_ID })
    mocks.impact.mockResolvedValue(impact)
    mocks.active.mockResolvedValue(null)
    mocks.start.mockResolvedValue(operation)
    mocks.status.mockResolvedValue(operation)
    mocks.tick.mockResolvedValue({ operation, advanced: true })
    mocks.target.mockResolvedValue(undefined)
  })

  it('binds impact to the teacher, classroom, and one student', async () => {
    const response = await getImpact(new NextRequest('http://localhost/purge'), context)
    expect(response.status).toBe(200)
    expect(mocks.requireRole).toHaveBeenCalledWith('teacher')
    expect(mocks.impact).toHaveBeenCalledWith(TEACHER_ID, CLASSROOM_ID, STUDENT_ID)
  })

  it('passes exact typed confirmation and both inventory digests', async () => {
    const response = await startPurge(new NextRequest('http://localhost/purge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_id: OPERATION_ID,
        confirmation: 'student@example.com',
        expected_source_revision: 7,
        expected_storage_inventory_sha256: DIGEST,
        expected_relational_inventory_sha256: DIGEST,
      }),
    }), context)
    expect(response.status).toBe(202)
    expect(mocks.start).toHaveBeenCalledWith({
      teacherId: TEACHER_ID, classroomId: CLASSROOM_ID, studentId: STUDENT_ID,
      operationId: OPERATION_ID, confirmation: 'student@example.com', expectedSourceRevision: 7,
      expectedStorageInventorySha256: DIGEST, expectedRelationalInventorySha256: DIGEST,
    })
  })

  it('rejects a student session before any purge state is read or changed', async () => {
    const error = new Error('Forbidden')
    error.name = 'AuthorizationError'
    mocks.requireRole.mockRejectedValue(error)
    const response = await getImpact(new NextRequest('http://localhost/purge'), context)
    expect(response.status).toBe(403)
    expect(mocks.impact).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('binds status and retry to the teacher and Classroom URL', async () => {
    expect((await getStatus(new NextRequest('http://localhost/status'), context)).status).toBe(200)
    expect((await tickPurge(new NextRequest('http://localhost/tick', { method: 'POST' }), context)).status).toBe(202)
    expect(mocks.status).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
    expect(mocks.tick).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID)
    expect(mocks.target).toHaveBeenCalledWith(TEACHER_ID, OPERATION_ID, CLASSROOM_ID, STUDENT_ID)
  })

  it('will not tick an operation through another Classroom URL', async () => {
    mocks.target.mockRejectedValue(new ApiError(404, 'Student data deletion not found'))
    const response = await tickPurge(new NextRequest('http://localhost/tick', { method: 'POST' }), {
      params: Promise.resolve({
        id: '50000000-0000-4000-8000-000000000001',
        studentId: STUDENT_ID,
        operationId: OPERATION_ID,
      }),
    } as never)
    expect(response.status).toBe(404)
    expect(mocks.tick).not.toHaveBeenCalled()
  })
})
