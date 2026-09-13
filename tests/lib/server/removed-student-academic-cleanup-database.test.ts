import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, from, remove } = vi.hoisted(() => {
  const remove = vi.fn()
  return { rpc: vi.fn(), from: vi.fn(() => ({ remove })), remove }
})
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc, storage: { from } }) }))
import { createRemovedStudentAcademicCleanupDatabaseCoordinator } from '@/lib/server/removed-student-academic-cleanup-database'

const scope = {
  operationId: '10000000-0000-4000-8000-000000000001', teacherId: '10000000-0000-4000-8000-000000000002',
  classroomId: '10000000-0000-4000-8000-000000000003', studentId: '10000000-0000-4000-8000-000000000004',
  generationId: '10000000-0000-4000-8000-000000000005',
}
const args = { p_operation_id: scope.operationId, p_teacher_id: scope.teacherId,
  p_classroom_id: scope.classroomId, p_student_id: scope.studentId, p_generation_id: scope.generationId }
const receipt = { schema_version: 1, operation_id: scope.operationId, teacher_id: scope.teacherId,
  classroom_id: scope.classroomId, student_id: scope.studentId, generation_id: scope.generationId,
  overall_status: 'provider_pending', local_status: 'inventoried', revision: 1,
  relational_inventory_sha256: 'a'.repeat(64), storage_inventory_sha256: 'b'.repeat(64), blockers: [], object: null }
const object = { id: '10000000-0000-4000-8000-000000000006', storage_bucket: 'assignment-artifacts',
  storage_path: 'fixture/exact.png', lease_token: '10000000-0000-4000-8000-000000000007' }

beforeEach(() => {
  vi.stubEnv('PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED', 'true')
  rpc.mockReset().mockResolvedValue({ data: receipt, error: null })
  remove.mockReset().mockResolvedValue({ error: null })
  from.mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('generated RPC academic cleanup bridge', () => {
  it('keeps the application gate ahead of RPC and storage access', async () => {
    vi.stubEnv('PIKA_REMOVED_STUDENT_ACADEMIC_CLEANUP_ENABLED', 'false')
    await expect(createRemovedStudentAcademicCleanupDatabaseCoordinator().advance(scope)).rejects.toThrow('academic_cleanup_disabled')
    expect(rpc).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('passes exact scope to inventory without storage access', async () => {
    await expect(createRemovedStudentAcademicCleanupDatabaseCoordinator().inventory(scope)).resolves.toEqual(receipt)
    expect(rpc).toHaveBeenCalledWith('advance_removed_student_academic_cleanup', {
      ...args, p_action: 'inventory', p_revision: undefined, p_object_id: undefined, p_lease_token: undefined,
    })
    expect(from).not.toHaveBeenCalled()
  })

  it('passes the exact leased callback after one file removal', async () => {
    rpc.mockResolvedValueOnce({ data: { ...receipt, local_status: 'deleting', object }, error: null })
    await createRemovedStudentAcademicCleanupDatabaseCoordinator().advance(scope)
    expect(from).toHaveBeenCalledExactlyOnceWith(object.storage_bucket)
    expect(remove).toHaveBeenCalledExactlyOnceWith([object.storage_path])
    expect(rpc).toHaveBeenNthCalledWith(2, 'advance_removed_student_academic_cleanup', {
      ...args, p_action: 'acknowledge', p_revision: 1, p_object_id: object.id, p_lease_token: object.lease_token,
    })
  })

  it.each([
    ['40001', 'academic_cleanup_retry_required'], ['42501', 'academic_cleanup_binding_invalid'],
    ['22023', 'academic_cleanup_binding_invalid'], ['55000', 'academic_cleanup_precondition_failed'],
    ['XX000', 'academic_cleanup_persistence_unavailable'],
  ])('fails closed and strips database details for %s', async (code, expected) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: 'sensitive database identifiers' } })
    await expect(createRemovedStudentAcademicCleanupDatabaseCoordinator().advance(scope)).rejects.toThrow(expected)
    expect(from).not.toHaveBeenCalled()
  })
})
