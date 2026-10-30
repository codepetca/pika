import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), config: vi.fn(), client: vi.fn(), erase: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getServiceRoleClient: () => ({ rpc: mocks.rpc }) }))
vi.mock('@/lib/server/repolight-client', () => ({ createRepoLightClient: mocks.client }))
vi.mock('@/lib/server/repolight-config', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/repolight-config')>(), parseRepoLightConfig: mocks.config,
}))
import { advanceReservedRepoLightCleanup, createRepoLightDecommissionDatabaseCoordinator } from '@/lib/server/repolight-decommission-database'

const teacherId = 'f2930000-0000-4000-8000-000000000001'
const classroomId = 'f2930000-0000-4000-8000-000000000010'
const operation = 'f2930000-0000-4000-8000-000000000070'
const subject = {
  id: 'f2930000-0000-4000-8000-000000000090', intent_id: 'f2930000-0000-4000-8000-000000000040',
  teacher_id: teacherId, classroom_id: classroomId, student_id: null, assignment_id: null,
  connection_ref: 'saved_connection', workspace_ref: 'saved_workspace', installation_ref: 'saved_installation',
  subject_ref: 'unknown_create_outcome', state: 'erasing', operation_id: operation, receipt: null,
}
const receipt = { schemaVersion: '1.0', operationRef: operation, installationRef: subject.installation_ref,
  subjectRef: subject.subject_ref, status: 'erased', absenceVerified: true }
const connection = { connectionRef: subject.connection_ref, teacherId, workspaceRef: subject.workspace_ref,
  installationRef: subject.installation_ref, active: false, apiKey: 'synthetic-not-used' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.config.mockReturnValue({ enabled: false, apiOrigin: 'https://fixture.invalid', connections: [connection] })
  mocks.client.mockReturnValue({ eraseSubject: mocks.erase })
  mocks.erase.mockResolvedValue(receipt)
  mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'read_repolight_cleanup_subjects_v1'
    ? mocks.erase.mock.calls.length ? [] : [subject]
    : name === 'record_repolight_subject_erasure_v1' ? { ...subject, state: 'erased', receipt } : subject,
  error: null }))
})

describe('typed RepoLight cleanup database adapter', () => {
  it('resolves retained managed credentials only after cleanup reservation, even with configuration removed', async () => {
    const saved = { ...subject, connection_ref: 'pika_managed_saved-operation' }
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'read_repolight_cleanup_subjects_v1'
      ? mocks.erase.mock.calls.length ? [] : [saved]
      : name === 'record_repolight_subject_erasure_v1' ? { ...saved, state: 'erased', receipt } : saved, error: null }))
    mocks.config.mockImplementation(() => { throw new Error('provisioning configuration removed') })
    const latest = { ...connection, connectionRef: saved.connection_ref, apiKey: 'replacement-key' }
    const registry = { ensure: vi.fn(), resolveSaved: vi.fn(async () => ({ connection: latest, apiOrigin: 'https://saved.invalid' })) }
    expect(await createRepoLightDecommissionDatabaseCoordinator(undefined, { managedRegistry: registry }).advance({ teacherId, classroomId }))
      .toEqual({ complete: true, erased: 1, pending: 0 })
    expect(registry.resolveSaved).toHaveBeenCalledExactlyOnceWith(teacherId, saved.connection_ref)
    expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(registry.resolveSaved.mock.invocationCallOrder[0])
    expect(registry.ensure).not.toHaveBeenCalled(); expect(mocks.config).not.toHaveBeenCalled()
    expect(mocks.client).toHaveBeenCalledWith(latest, { apiOrigin: 'https://saved.invalid' })
  })

  it('keeps a pending managed rotation unavailable without credential fallback or false erasure completion', async () => {
    const saved = { ...subject, connection_ref: 'pika_managed_saved-operation' }
    mocks.rpc.mockImplementation(async name => ({ data: name === 'read_repolight_cleanup_subjects_v1' ? [saved] : saved, error: null }))
    const registry = { ensure: vi.fn(), resolveSaved: vi.fn(async () => { throw new Error('repolight_managed_pending') }) }
    await expect(createRepoLightDecommissionDatabaseCoordinator(undefined, { managedRegistry: registry }).advance({ teacherId, classroomId }))
      .rejects.toMatchObject({ code: 'repolight_cleanup_unavailable', retryable: true })
    expect(registry.ensure).not.toHaveBeenCalled(); expect(mocks.erase).not.toHaveBeenCalled(); expect(mocks.config).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalledWith('record_repolight_subject_erasure_v1', expect.anything())
  })

  it('uses saved inactive connection identity while Analyze is paused and records only strict receipts', async () => {
    expect(await createRepoLightDecommissionDatabaseCoordinator().advance({ teacherId, classroomId }))
      .toEqual({ complete: true, erased: 1, pending: 0 })
    expect(mocks.client).toHaveBeenCalledWith(connection, { apiOrigin: 'https://fixture.invalid' })
    expect(mocks.rpc).toHaveBeenCalledWith('record_repolight_subject_erasure_v1', {
      p_actor_id: teacherId, p_binding_id: subject.id, p_operation_id: operation, p_receipt: receipt,
    })
    expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(mocks.erase.mock.invocationCallOrder[0])
  })

  it('denies connection workspace drift before the provider request', async () => {
    mocks.config.mockReturnValue({ enabled: false, apiOrigin: 'https://fixture.invalid',
      connections: [{ ...connection, workspaceRef: 'another_workspace' }] })
    await expect(createRepoLightDecommissionDatabaseCoordinator().advance({ teacherId, classroomId }))
      .rejects.toMatchObject({ code: 'repolight_cleanup_binding_invalid' })
    expect(mocks.client).not.toHaveBeenCalled()
    expect(mocks.erase).not.toHaveBeenCalled()
  })

  it('never treats RPC errors as subject absence or provider completion', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'private details' } })
    await expect(createRepoLightDecommissionDatabaseCoordinator().advance({ teacherId, classroomId }))
      .rejects.toMatchObject({ code: 'repolight_cleanup_pending', retryable: true })
    expect(mocks.client).not.toHaveBeenCalled()
  })
})


describe('reserved lifecycle cleanup', () => {
  it('reads only the actor-bound immutable parent snapshot and reuses its erasure IDs', async () => {
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'read_repolight_purge_cleanup_subjects_v1'
      ? mocks.erase.mock.calls.length ? [] : [subject]
      : name === 'record_repolight_subject_erasure_v1' ? { ...subject, state: 'erased', receipt } : subject,
    error: null }))
    await expect(advanceReservedRepoLightCleanup(teacherId, operation)).resolves.toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('read_repolight_purge_cleanup_subjects_v1', {
      p_actor_id: teacherId, p_operation_id: operation,
    })
    expect(mocks.rpc).not.toHaveBeenCalledWith('read_repolight_cleanup_subjects_v1', expect.anything())
  })

  it('reports missing cleanup credentials as unavailable and preserves saved progress', async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === 'read_repolight_purge_cleanup_subjects_v1' ? [subject] : subject, error: null }))
    mocks.config.mockImplementation(() => { throw new Error('private configuration details') })
    await expect(advanceReservedRepoLightCleanup(teacherId, operation)).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.erase).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalledWith('record_repolight_subject_erasure_v1', expect.anything())
  })

  it('does not invent an erasure ID when a reserved snapshot is malformed', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...subject, operation_id: null }], error: null })
    await expect(advanceReservedRepoLightCleanup(teacherId, operation)).rejects.toMatchObject({ code: 'repolight_cleanup_binding_invalid' })
    expect(mocks.erase).not.toHaveBeenCalled()
  })

  it('leaves retryable failures pending and accepts ordinary reserved operations with no subjects', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000' } })
    await expect(advanceReservedRepoLightCleanup(teacherId, operation)).resolves.toBe(false)
    mocks.rpc.mockResolvedValue({ data: [], error: null })
    await expect(advanceReservedRepoLightCleanup(teacherId, operation)).resolves.toBe(true)
    expect(mocks.erase).not.toHaveBeenCalled()
  })
})
