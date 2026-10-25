import { beforeEach, describe, expect, it, vi } from 'vitest'
const service = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => service }))
vi.mock('@/lib/server/repolight-decommission-database', () => ({ advanceReservedRepoLightCleanup: vi.fn() }))
import { deleteAssignmentWithRepoLightCleanup, replayCompletedAssignmentDeletion } from '@/lib/server/repolight-assignment-delete'
const actorId = 'f2930000-0000-4000-8000-000000000001'
const assignmentId = 'f2930000-0000-4000-8000-000000000020'
const operationId = 'f2930000-0000-4000-8000-000000000070'
const otherId = 'f2930000-0000-4000-8000-000000000071'
const context = { assignment_id: assignmentId, classroom_id: 'f2930000-0000-4000-8000-000000000010',
  assignment_updated_at: '2026-10-01T00:00:00.000Z', source_fingerprint: 'a'.repeat(64), subject_count: 1, pending_operation_id: null as string | null }
const rpc = vi.fn(), cleanup = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  cleanup.mockResolvedValue(true)
  rpc.mockImplementation(async name => ({ error: null, data: name === 'get_repolight_assignment_delete_context_v1' ? context
    : name === 'reserve_repolight_assignment_delete_v1' ? { operation_id: operationId, kind: 'assignment_delete', status: 'cleanup_pending', pending_subject_count: 1 }
      : { ok: true, deleted: true } }))
})
describe('confirmed assignment cleanup adoption', () => {
  it('reserves the locked source before egress and finalizes only after verified cleanup', async () => {
    await expect(deleteAssignmentWithRepoLightCleanup({ actorId, assignmentId, operationId }, { client: { rpc }, cleanup })).resolves.toEqual({ complete: true, operationId })
    expect(rpc).toHaveBeenCalledWith('reserve_repolight_assignment_delete_v1', {
      p_actor_id: actorId, p_assignment_id: assignmentId, p_operation_id: operationId,
      p_expected_updated_at: context.assignment_updated_at, p_expected_source_fingerprint: context.source_fingerprint,
    })
    expect(rpc.mock.invocationCallOrder[1]).toBeLessThan(cleanup.mock.invocationCallOrder[0])
    expect(cleanup.mock.invocationCallOrder[0]).toBeLessThan(rpc.mock.invocationCallOrder[2])
  })
  it('retains pending operations without claiming deletion success or finalizing', async () => {
    cleanup.mockResolvedValue(false)
    await expect(deleteAssignmentWithRepoLightCleanup({ actorId, assignmentId, operationId }, { client: { rpc }, cleanup })).resolves.toEqual({ complete: false, operationId })
    expect(rpc).not.toHaveBeenCalledWith('finalize_repolight_assignment_delete_v1', expect.anything())
  })
  it('reuses an older confirmed intent on reopened deletion instead of recapturing work', async () => {
    rpc.mockImplementation(async name => ({ error: null, data: name === 'get_repolight_assignment_delete_context_v1'
      ? { ...context, pending_operation_id: operationId }
      : { operation_id: operationId, kind: 'assignment_delete', status: 'cleanup_pending', pending_subject_count: 1 } }))
    cleanup.mockResolvedValue(false)
    await expect(deleteAssignmentWithRepoLightCleanup({ actorId, assignmentId, operationId: otherId }, { client: { rpc }, cleanup })).resolves.toEqual({ complete: false, operationId })
    expect(cleanup).toHaveBeenCalledWith(actorId, operationId, 'decommission')
  })
  it('binds completed replay to actor, operation and requested assignment before acknowledging deletion', async () => {
    service.rpc.mockResolvedValue({ data: { ok: true, deleted: true, replayed: true }, error: null })
    await expect(replayCompletedAssignmentDeletion(actorId, assignmentId, operationId)).resolves.toBe(true)
    expect(service.rpc).toHaveBeenCalledWith('finalize_repolight_assignment_delete_v1', {
      p_actor_id: actorId, p_assignment_id: assignmentId, p_operation_id: operationId,
    })
    service.rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(replayCompletedAssignmentDeletion(actorId, otherId, operationId)).resolves.toBe(false)
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('never calls a provider after denied ownership or changed source', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501' } })
    await expect(deleteAssignmentWithRepoLightCleanup({ actorId, assignmentId, operationId }, { client: { rpc }, cleanup })).rejects.toMatchObject({ statusCode: 403 })
    expect(cleanup).not.toHaveBeenCalled()
  })
})
