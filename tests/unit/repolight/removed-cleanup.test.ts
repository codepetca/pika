import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), cleanup: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/server/repolight-decommission-database', () => ({ advanceReservedRepoLightCleanup: mocks.cleanup }))
import { getRepoLightRemovedContext, projectRepoLightRemovedStatus, reserveRepoLightRemovedCleanup, advanceRepoLightRemovedCleanup } from '@/lib/server/repolight-removed-student-cleanup'
import { liveCleanupStatusSchema } from '@/lib/validations/live-student-cleanup'
const scope = { teacherId: 'f2930000-0000-4000-8000-000000000001', classroomId: 'f2930000-0000-4000-8000-000000000010',
  studentId: 'f2930000-0000-4000-8000-000000000030', generationId: 'f2930000-0000-4000-8000-000000000050', operationId: 'f2930000-0000-4000-8000-000000000070' }
const context = { schema_version: 1 as const, email: 'synthetic@example.test', name: 'Synthetic member', classroom_id: scope.classroomId, student_id: scope.studentId, generation_id: scope.generationId,
  scope: 'repolight_only' as const, provider_bound: false, other_providers: 'out_of_scope' as const, operation_id: null as string | null, status: 'not_reserved' as const,
  pending_subject_count: 1, total_subject_count: 1, academic_preserved: true as const }
beforeEach(() => {
  vi.resetAllMocks(); mocks.cleanup.mockResolvedValue(true)
  mocks.rpc.mockImplementation(async name => ({ error: null, data: name === 'get_repolight_removed_student_cleanup_context_v1' ? context
    : { operation_id: scope.operationId, kind: 'removed_student', status: 'cleanup_pending', pending_subject_count: 1 } }))
})
describe('manual remote-only retained-generation cleanup', () => {
  it('discovers without reservation, provider calls or academic work', async () => {
    await expect(getRepoLightRemovedContext(scope)).resolves.toEqual(context)
    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('get_repolight_removed_student_cleanup_context_v1', expect.objectContaining({ p_actor_id: scope.teacherId, p_generation_id: scope.generationId }))
    expect(mocks.cleanup).not.toHaveBeenCalled()
  })
  it('reserves without egress and describes remote-only completion without academic or provider receipts', async () => {
    const result = await reserveRepoLightRemovedCleanup(scope)
    expect(liveCleanupStatusSchema.parse(result)).toMatchObject({ scope: 'repolight_only', academic_preserved: true,
      pal: 'out_of_scope', bara: 'out_of_scope', local_status: 'not_started', cleanup_completed: false })
    expect(mocks.cleanup).not.toHaveBeenCalled()
    expect(liveCleanupStatusSchema.parse(projectRepoLightRemovedStatus({ ...context, operation_id: scope.operationId,
      status: 'completed', pending_subject_count: 0 }))).toMatchObject({ cleanup_completed: true, academic_preserved: true, local_status: 'not_started' })
  })
  it('keeps other providers out of scope and requires exact generation before reservation', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { ...context, provider_bound: true }, error: null })
    await expect(reserveRepoLightRemovedCleanup(scope)).resolves.toMatchObject({ academic_preserved: true, pal: 'out_of_scope', bara: 'out_of_scope' })
    mocks.rpc.mockResolvedValueOnce({ data: { ...context, generation_id: scope.operationId }, error: null })
    await expect(reserveRepoLightRemovedCleanup(scope)).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.cleanup).not.toHaveBeenCalled()
  })
  it('advances only its saved operation and re-reads completion rather than inferring it from HTTP', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...context, operation_id: scope.operationId, status: 'cleanup_pending' }, error: null })
    await expect(advanceRepoLightRemovedCleanup(scope)).resolves.toMatchObject({ cleanup_completed: false, repolight_cleanup_pending: true })
    expect(mocks.cleanup).toHaveBeenCalledWith(scope.teacherId, scope.operationId, 'decommission')
    mocks.cleanup.mockClear()
    await expect(advanceRepoLightRemovedCleanup({ ...scope, operationId: scope.generationId })).rejects.toMatchObject({ statusCode: 409 })
    expect(mocks.cleanup).not.toHaveBeenCalled()
  })
})
