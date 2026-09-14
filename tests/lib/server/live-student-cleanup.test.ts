import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLiveStudentCleanup, requireLiveStudentCleanupEnabled } from '@/lib/server/live-student-cleanup'
import { StudentProviderCleanupError } from '@/lib/server/student-provider-cleanup'
const scope = { operationId: 'a0000000-0000-4000-8000-000000000001', teacherId: 'a0000000-0000-4000-8000-000000000002', classroomId: 'a0000000-0000-4000-8000-000000000003', studentId: 'a0000000-0000-4000-8000-000000000004', generationId: 'a0000000-0000-4000-8000-000000000005' }
function fixture() {
  const pending = { operation_id: scope.operationId, status: 'provider_pending' as const, pal: 'pending' as const, bara: 'deleting', cleanup_completed: false }
  const providersDone = { ...pending, pal: 'completed' as const, bara: 'deleted' }
  const providers = {
    read: vi.fn().mockResolvedValue(providersDone), reserve: vi.fn().mockResolvedValue(pending),
    advance: vi.fn().mockResolvedValue(providersDone),
    finish: vi.fn().mockResolvedValue({ ...providersDone, status: 'completed', cleanup_completed: true }),
  }
  const academic = { inventory: vi.fn().mockResolvedValue({ blockers: [] }),
    advance: vi.fn().mockResolvedValue({ blockers: [], local_status: 'local_completed' }) }
  return { providers, academic, pending, coordinator: createLiveStudentCleanup({ providers, academic }) }
}
afterEach(() => vi.unstubAllEnvs())
describe('explicit live membership purge', () => {
  it.each(['', 'false', 'TRUE', '*'])('defaults off for %s', value => {
    vi.stubEnv('PIKA_LIVE_STUDENT_CLEANUP_ENABLED', value)
    expect(requireLiveStudentCleanupEnabled).toThrow('Live classroom cleanup is not enabled')
  })
  it('reservation performs no provider HTTP or academic work', async () => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    expect(f.providers.reserve).toHaveBeenCalledWith(scope)
    expect(f.providers.advance).not.toHaveBeenCalled()
    expect(f.academic.inventory).not.toHaveBeenCalled()
  })
  it('gives Bara progress even when Pal fails and never mistakes partial success for completion', async () => {
    const f = fixture()
    f.providers.advance.mockImplementation(async (_scope, provider) => {
      if (provider === 'pal') throw new StudentProviderCleanupError('provider_unavailable', true)
      return f.pending
    })
    const result = await f.coordinator.advance(scope)
    expect(f.providers.advance.mock.calls.map(call => call[1])).toEqual(['pal', 'bara'])
    expect(result.errors).toEqual([{ stage: 'pal', retryable: true }])
    expect(result.cleanup_completed).toBe(false)
    expect(f.academic.advance).not.toHaveBeenCalled()
    expect(f.providers.finish).not.toHaveBeenCalled()
  })
  it('runs both verified providers, bounded academic/file work, then the database finalizer', async () => {
    const f = fixture()
    expect(await f.coordinator.advance(scope)).toMatchObject({ status: 'completed', cleanup_completed: true })
    expect(f.providers.advance).toHaveBeenCalledTimes(2)
    expect(f.academic.advance).toHaveBeenCalledExactlyOnceWith(scope)
    expect(f.providers.finish).toHaveBeenCalledExactlyOnceWith(scope)
  })
  it.each(['provider', 'inventory', 'file'])('retains re-add restriction while %s remains pending', async stage => {
    const f = fixture()
    if (stage === 'provider') f.providers.read.mockResolvedValue(f.pending)
    if (stage === 'inventory') f.academic.inventory.mockResolvedValue({ blockers: ['remote_grading_policy_required'] })
    if (stage === 'file') f.academic.advance.mockResolvedValue({ blockers: [], local_status: 'deleting' })
    expect(await f.coordinator.advance(scope)).toMatchObject({ cleanup_completed: false })
    expect(f.providers.finish).not.toHaveBeenCalled()
  })
  it('does not reinterpret a lost finalizer response as completion', async () => {
    const f = fixture()
    f.providers.finish.mockRejectedValue(new Error('lost response'))
    await expect(f.coordinator.advance(scope)).rejects.toThrow('lost response')
    expect(f.providers.finish).toHaveBeenCalledExactlyOnceWith(scope)
  })
  it('replays completed status without calling providers or academic writers', async () => {
    const f = fixture()
    f.providers.read.mockResolvedValue({ ...f.pending, status: 'completed', cleanup_completed: true })
    expect(await f.coordinator.advance(scope)).toMatchObject({ cleanup_completed: true })
    expect(f.providers.advance).not.toHaveBeenCalled()
    expect(f.academic.advance).not.toHaveBeenCalled()
  })
})
