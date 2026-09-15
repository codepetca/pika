import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const { rpc, pal } = vi.hoisted(() => ({ rpc: vi.fn(), pal: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc }) }))
vi.mock('@/lib/server/pal-profile-erasure', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/pal-profile-erasure')>(), requestPalProfileErasure: pal,
}))
import { createStudentProviderCleanupDatabaseCoordinator } from '@/lib/server/student-provider-cleanup-database'

const scope = { operationId: 'a0000000-0000-4000-8000-000000000001', teacherId: 'a0000000-0000-4000-8000-000000000002',
  classroomId: 'a0000000-0000-4000-8000-000000000003', studentId: 'a0000000-0000-4000-8000-000000000004',
  generationId: 'a0000000-0000-4000-8000-000000000005' }
const binding = { schema_version: 1, operation_id: scope.operationId, generation_id: scope.generationId,
  status: 'provider_pending', pal_origin: 'https://pal.example.invalid',
  pal_integration_id: 'a0000000-0000-4000-8000-000000000006', pal_reference: `pika-membership-v1-${'a'.repeat(32)}`,
  bara_origin: 'https://bara.example.invalid', installation_ref: 'installation_one', roster_ref: 'roster_one',
  participant_ref: 'participant_one', actor_principal_ref: 'principal_one', pal_receipt: null, bara_receipt: null }
const args = { p_operation_id: scope.operationId, p_teacher_id: scope.teacherId, p_classroom_id: scope.classroomId,
  p_student_id: scope.studentId, p_generation_id: scope.generationId }
beforeEach(() => {
  vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'true')
  rpc.mockReset().mockResolvedValue({ data: binding, error: null })
  pal.mockReset()
})
afterEach(() => vi.unstubAllEnvs())
describe('generated RPC provider cleanup bridge', () => {
  it('reserves only the exact authenticated scope and performs no HTTP', async () => {
    const coordinator = createStudentProviderCleanupDatabaseCoordinator()
    await expect(coordinator.reserve(scope)).resolves.toMatchObject({ status: 'provider_pending', cleanup_completed: false })
    expect(rpc).toHaveBeenCalledWith('reserve_student_provider_cleanup', args)
    expect(pal).not.toHaveBeenCalled()
  })
  it('keeps status readable while the application gate is paused', async () => {
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'false')
    const coordinator = createStudentProviderCleanupDatabaseCoordinator()
    await expect(coordinator.reserve(scope)).rejects.toMatchObject({ code: 'disabled' })
    expect(rpc).not.toHaveBeenCalled()
    await coordinator.read(scope)
    expect(rpc).toHaveBeenCalledWith('get_student_provider_cleanup', args)
  })
  it.each([
    ['42501', 'forbidden detail', 'binding_invalid', false],
    ['55000', 'student_provider_cleanup_disabled', 'disabled', false],
    ['40001', 'classroom_operation_busy', 'persistence_unavailable', true],
  ])('does not send on rejected authorization %s', async (code, message, expected, retryable) => {
    rpc.mockResolvedValue({ data: null, error: { code, message } })
    const coordinator = createStudentProviderCleanupDatabaseCoordinator()
    await expect(coordinator.advance(scope, 'pal')).rejects.toMatchObject({ code: expected, retryable })
    expect(rpc).toHaveBeenCalledWith('authorize_student_provider_cleanup', args)
    expect(pal).not.toHaveBeenCalled()
  })
  it('records the exact verified receipt after authorization and one provider attempt', async () => {
    const receipt = { schema_version: 1, operation_id: scope.operationId, learner_id: binding.pal_reference,
      status: 'pending', begun_at: '2026-09-13T15:00:00Z', completed_at: null }
    pal.mockResolvedValue(receipt)
    rpc.mockResolvedValueOnce({ data: binding, error: null })
      .mockResolvedValueOnce({ data: { ...binding, pal_receipt: receipt }, error: null })
    await createStudentProviderCleanupDatabaseCoordinator().advance(scope, 'pal')
    expect(rpc).toHaveBeenNthCalledWith(1, 'authorize_student_provider_cleanup', args)
    expect(rpc).toHaveBeenNthCalledWith(2, 'record_student_provider_cleanup_receipt', {
      ...args, p_provider: 'pal', p_receipt: receipt,
    })
    expect(pal).toHaveBeenCalledTimes(1)
  })
})
