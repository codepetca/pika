import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PalErasureError, type PalErasureReceipt } from '@/lib/server/pal-profile-erasure'
import { createStudentProviderCleanupCoordinator, type StudentProviderBinding } from '@/lib/server/student-provider-cleanup'
const scope = { operationId: 'a0000000-0000-4000-8000-000000000001', teacherId: 'a0000000-0000-4000-8000-000000000002', classroomId: 'a0000000-0000-4000-8000-000000000003', studentId: 'a0000000-0000-4000-8000-000000000004', generationId: 'a0000000-0000-4000-8000-000000000005' }
const binding: StudentProviderBinding = { schema_version: 1, operation_id: scope.operationId, generation_id: scope.generationId, status: 'provider_pending', pal_origin: 'https://pal.example.invalid', pal_integration_id: 'a0000000-0000-4000-8000-000000000006', pal_reference: `pika-membership-v1-${'a'.repeat(32)}`, bara_origin: 'https://bara.example.invalid', installation_ref: 'pika_installation', roster_ref: 'roster_one', participant_ref: 'participant_one', actor_principal_ref: 'principal_one', pal_receipt: null, bara_receipt: null }
const palReceipt = { schema_version: 1 as const, operation_id: scope.operationId, learner_id: binding.pal_reference, status: 'completed' as const, begun_at: '2026-09-13T15:00:00Z', completed_at: '2026-09-13T15:01:00Z' }
function fixture() {
  let saved = structuredClone(binding)
  let reserved = false
  const reserve = vi.fn(async () => { reserved = true; return saved })
  const authorize = vi.fn(async () => { if (!reserved) throw new Error('no durable stage'); return saved })
  const read = vi.fn(async () => saved)
  const record = vi.fn(async (_scope, provider, receipt) => {
    saved = { ...saved, [provider === 'pal' ? 'pal_receipt' : 'bara_receipt']: receipt }
    return saved
  })
  const pal = vi.fn(async (): Promise<PalErasureReceipt> => palReceipt)
  const bara = vi.fn(async request => ({ schema_version: 1 as const, ok: true as const,
    installation_ref: request.installation_ref, roster_ref: request.roster_ref, participant_ref: request.participant_ref,
    operation_ref: request.operation_ref, state: 'deleted' as const, absence_verified: true, deleted_count: 7 }))
  const invalidate = vi.fn()
  const coordinator = createStudentProviderCleanupCoordinator({ reserve, authorize, read, record, pal, bara, invalidate })
  return { coordinator, reserve, authorize, read, record, pal, bara, invalidate, set: (next: StudentProviderBinding) => { saved = next } }
}
beforeEach(() => vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', 'true'))
afterEach(() => vi.unstubAllEnvs())
describe('durable provider prerequisite coordination', () => {
  it('is disabled before any persistence or transport', async () => {
    vi.stubEnv('STUDENT_PROVIDER_CLEANUP_ENABLED', '')
    const f = fixture()
    await expect(f.coordinator.reserve(scope)).rejects.toMatchObject({ code: 'disabled' })
    await expect(f.coordinator.advance(scope, 'pal')).rejects.toMatchObject({ code: 'disabled' })
    expect(f.reserve).not.toHaveBeenCalled(); expect(f.authorize).not.toHaveBeenCalled(); expect(f.pal).not.toHaveBeenCalled()
  })
  it('cannot send without an authorized durable binding', async () => {
    const f = fixture()
    await expect(f.coordinator.advance(scope, 'pal')).rejects.toMatchObject({ code: 'persistence_unavailable' })
    expect(f.pal).not.toHaveBeenCalled(); expect(f.bara).not.toHaveBeenCalled()
  })
  it('reserves without HTTP and makes only one provider attempt per advance', async () => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    expect(f.pal).not.toHaveBeenCalled(); expect(f.bara).not.toHaveBeenCalled()
    await f.coordinator.advance(scope, 'pal')
    expect(f.pal).toHaveBeenCalledWith('begin', { operation_id: scope.operationId, learner_id: binding.pal_reference }, { binding: { origin: binding.pal_origin, integrationId: binding.pal_integration_id } })
    expect(f.bara).not.toHaveBeenCalled()
    expect(await f.coordinator.advance(scope, 'bara')).toMatchObject({ status: 'provider_pending', pal: 'completed', bara: 'deleted', cleanup_completed: false })
    expect(f.bara).toHaveBeenCalledTimes(1)
    await f.coordinator.advance(scope, 'bara')
    expect(f.bara).toHaveBeenCalledTimes(1)
  })
  it('reuses exact operation and provider reference after losing receipt persistence', async () => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    f.record.mockRejectedValueOnce(new Error('lost database response'))
    await expect(f.coordinator.advance(scope, 'pal')).rejects.toMatchObject({ code: 'persistence_unavailable' })
    await f.coordinator.advance(scope, 'pal')
    expect(f.pal.mock.calls[0]).toEqual(f.pal.mock.calls[1])
    expect(f.pal).toHaveBeenCalledTimes(2)
  })
  it.each(['remote_rejected', 'invalid_receipt'] as const)('preserves retryable Pal uncertainty for %s without persisting proof', async code => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    f.pal.mockRejectedValueOnce(new PalErasureError(code, true, code === 'remote_rejected' ? 404 : 200))
    await expect(f.coordinator.advance(scope, 'pal')).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true })
    expect(f.record).not.toHaveBeenCalled()
    expect(f.pal).toHaveBeenCalledTimes(1)
    expect(await f.coordinator.advance(scope, 'pal')).toMatchObject({ status: 'provider_pending', cleanup_completed: false })
    expect(f.pal.mock.calls[0]).toEqual(f.pal.mock.calls[1])
  })
  it.each(['operation_id','generation_id','pal_reference'] as const)('rejects wrong saved %s before networking', async field => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    f.set({ ...binding, [field]: 'invalid' })
    await expect(f.coordinator.advance(scope, 'pal')).rejects.toMatchObject({ code: 'binding_invalid' })
    expect(f.pal).not.toHaveBeenCalled()
  })
  it('does not accept a response for another membership', async () => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    f.pal.mockResolvedValueOnce({ ...palReceipt, learner_id: `pika-membership-v1-${'b'.repeat(32)}` })
    await expect(f.coordinator.advance(scope, 'pal')).rejects.toMatchObject({ code: 'binding_invalid' })
    expect(f.record).not.toHaveBeenCalled()
  })
  it('keeps managed-copy pending Pal state pending and retains its fence identity', async () => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    f.pal.mockImplementationOnce(async () => ({ ...palReceipt, status: 'pending', completed_at: null }))
    expect(await f.coordinator.advance(scope, 'pal')).toMatchObject({ pal: 'pending', cleanup_completed: false })
    expect(f.bara).not.toHaveBeenCalled()
    expect(f.invalidate).toHaveBeenCalledWith(binding.pal_reference)
  })
  it('can establish Bara independently while Pal managed-copy proof remains pending', async () => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    f.pal.mockImplementationOnce(async () => ({ ...palReceipt, status: 'pending', completed_at: null }))
    await f.coordinator.advance(scope, 'pal')
    expect(await f.coordinator.advance(scope, 'bara')).toMatchObject({ pal: 'pending', bara: 'deleted', cleanup_completed: false })
    expect(f.pal).toHaveBeenCalledTimes(1)
    expect(f.bara).toHaveBeenCalledTimes(1)
  })
  it('does not claim a provider receipt was saved when persistence returns stale evidence', async () => {
    const f = fixture()
    await f.coordinator.reserve(scope)
    f.record.mockResolvedValueOnce(binding)
    await expect(f.coordinator.advance(scope, 'pal')).rejects.toMatchObject({ code: 'binding_invalid' })
  })
})
