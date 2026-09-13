import { describe, expect, it, vi } from 'vitest'
import { createRemovedStudentAcademicCleanup } from '@/lib/server/removed-student-academic-cleanup'

const scope = {
  operationId: '10000000-0000-4000-8000-000000000001',
  teacherId: '10000000-0000-4000-8000-000000000002',
  classroomId: '10000000-0000-4000-8000-000000000003',
  studentId: '10000000-0000-4000-8000-000000000004',
  generationId: '10000000-0000-4000-8000-000000000005',
}
const receipt = {
  schema_version: 1, operation_id: scope.operationId, teacher_id: scope.teacherId,
  classroom_id: scope.classroomId, student_id: scope.studentId, generation_id: scope.generationId,
  overall_status: 'provider_pending', local_status: 'inventoried', revision: 1,
  relational_inventory_sha256: 'a'.repeat(64), storage_inventory_sha256: 'b'.repeat(64),
  blockers: [], object: null,
}
const object = {
  id: '10000000-0000-4000-8000-000000000006',
  storage_bucket: 'assignment-artifacts', storage_path: 'exact/student/file.png',
  lease_token: '10000000-0000-4000-8000-000000000007',
}

function setup(enabled = true) {
  const execute = vi.fn().mockResolvedValue(receipt)
  const remove = vi.fn().mockResolvedValue({ error: null })
  const storage = { from: vi.fn(() => ({ remove })) }
  return { execute, remove, storage, api: createRemovedStudentAcademicCleanup({ execute, storage, enabled: () => enabled }) }
}

describe('explicit removed membership academic cleanup', () => {
  it('does nothing with its independent gate off', async () => {
    const { api, execute, remove } = setup(false)
    await expect(api.inventory(scope)).rejects.toThrow('academic_cleanup_disabled')
    await expect(api.advance(scope)).rejects.toThrow('academic_cleanup_disabled')
    expect(execute).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('allows inventory while provider/copy proof is incomplete without storage traffic', async () => {
    const { api, execute, remove } = setup()
    execute.mockResolvedValue({ ...receipt, blockers: ['provider_completion_required', 'copy_policy_required'] })
    expect((await api.inventory(scope)).blockers).toHaveLength(2)
    expect(execute).toHaveBeenCalledWith(scope, { action: 'inventory' })
    expect(remove).not.toHaveBeenCalled()
  })

  it.each(['operation_id', 'teacher_id', 'classroom_id', 'student_id', 'generation_id'])('rejects a mismatched %s before deletion', async key => {
    const { api, execute, remove } = setup()
    execute.mockResolvedValue({ ...receipt, [key]: '20000000-0000-4000-8000-000000000001', object })
    await expect(api.advance(scope)).rejects.toThrow()
    expect(remove).not.toHaveBeenCalled()
  })

  it('rejects overall completion and unsafe buckets', async () => {
    const { api, execute, remove } = setup()
    execute.mockResolvedValue({ ...receipt, overall_status: 'completed' })
    await expect(api.advance(scope)).rejects.toThrow()
    execute.mockResolvedValue({ ...receipt, local_status: 'deleting', object: { ...object, storage_bucket: 'classroom-archives' } })
    await expect(api.advance(scope)).rejects.toThrow()
    expect(remove).not.toHaveBeenCalled()
  })

  it('never treats unknown/provider/copy blockers as an empty successful inventory', async () => {
    const { api, execute, remove } = setup()
    execute.mockResolvedValue({ ...receipt, blockers: ['unknown_resource'], object })
    expect((await api.advance(scope)).blockers).toEqual(['unknown_resource'])
    expect(remove).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('deletes one exact claimed object and acknowledges the same revision and lease', async () => {
    const { api, execute, remove, storage } = setup()
    execute.mockResolvedValueOnce({ ...receipt, local_status: 'deleting', object })
    await api.advance(scope)
    expect(storage.from).toHaveBeenCalledWith('assignment-artifacts')
    expect(remove).toHaveBeenCalledWith([object.storage_path])
    expect(execute).toHaveBeenLastCalledWith(scope, {
      action: 'acknowledge', revision: 1, objectId: object.id, leaseToken: object.lease_token,
    })
  })

  it('leaves lost acknowledgments for lease retry without submitting a contradictory failure', async () => {
    const { api, execute, remove } = setup()
    execute.mockResolvedValueOnce({ ...receipt, local_status: 'deleting', object })
      .mockRejectedValueOnce(new Error('lost_response'))
    await expect(api.advance(scope)).rejects.toThrow('lost_response')
    expect(remove).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls.map(call => call[1].action)).toEqual(['claim', 'acknowledge'])
  })

  it('uses a fixed privacy-safe error classification for failed storage attempts', async () => {
    const { api, execute, remove } = setup()
    execute.mockResolvedValueOnce({ ...receipt, local_status: 'deleting', object })
    remove.mockResolvedValueOnce({ error: new Error('private student path') })
    await api.advance(scope)
    expect(execute).toHaveBeenLastCalledWith(scope, {
      action: 'fail', revision: 1, objectId: object.id, leaseToken: object.lease_token,
    })
  })

  it('acknowledges missing-object replies only through database absence verification', async () => {
    const { api, execute, remove } = setup()
    execute.mockResolvedValueOnce({ ...receipt, local_status: 'deleting', object })
    remove.mockResolvedValueOnce({ error: { code: 'NoSuchKey' } })
    await api.advance(scope)
    expect(execute.mock.calls[1][1].action).toBe('acknowledge')
  })

  it('reports durable local completion without claiming overall completion', async () => {
    const { api, execute, remove } = setup()
    execute.mockResolvedValue({ ...receipt, local_status: 'local_completed' })
    const result = await api.advance(scope)
    expect(result.overall_status).toBe('provider_pending')
    expect(result.local_status).toBe('local_completed')
    expect(remove).not.toHaveBeenCalled()
  })
})
