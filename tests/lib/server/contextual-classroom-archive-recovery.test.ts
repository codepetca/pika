import { createClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/types/database'
import { classroom, actorId, classroomId, otherId, timestamp } from '../../helpers/contextual-classroom-detail'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), exporter: vi.fn(), allowed: vi.fn(() => true), hotPurge: vi.fn(), coldPurge: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }))
vi.mock('@/lib/server/classroom-archive-operations', () => ({ exportClassroomArchive: mocks.exporter, isClassroomArchiveExportAllowed: mocks.allowed }))
vi.mock('@/lib/server/classroom-archive-restore-operations', () => ({ isClassroomArchiveRestoreAllowed: () => false, resolveClassroomArchiveRestoreDatabaseBudget: () => 1 }))
vi.mock('@/lib/server/classroom-purge-availability', () => ({ listHotClassroomPurgeEnabledIds: mocks.hotPurge, listColdClassroomPurgeEnabledIds: mocks.coldPurge }))
import { authorizeSharedClassroomArchiveActor, exportContextualClassroomArchive, listContextualClassroomArchiveRecovery, readContextualClassroomArchiveSnapshot } from '@/lib/server/contextual-classroom-archive-recovery'
import { contextualArchiveSnapshotEnvelopeSchema } from '@/lib/validations/contextual-classroom-archive-recovery'

const operationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const archiveId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const retention = { mode: 'teacher_managed' as const, delete_after: null }
const hot = () => ({ classroom: { ...classroom, archived_at: timestamp }, current_revision: 7, latest_archive: null, latest_operation: null })
const snapshot = () => ({ actor_id: actorId, hot_classrooms: [hot()], cold_archives: [], verified_export: null })
const completed = () => ({
  ok: true as const, status: 201 as const, operation_id: operationId, archive_id: archiveId, replayed: false,
  artifact_sha256: 'a'.repeat(64), content_sha256: 'b'.repeat(64), compressed_byte_size: 100, uncompressed_byte_size: 200,
  resource_counts: { classrooms: 1 }, storage_object_counts: { total_count: 0, total_bytes: 0 },
  verification: { read_back_verified: true, artifact_checksum_verified: true, manifest_verified: true, resource_checksums_verified: true,
    resource_counts_verified: true, storage_objects_verified: true, actor_snapshots_verified: true, verified_at: timestamp },
})
function exportSnapshot() {
  const { ok: _ok, status: _status, replayed: _replayed, ...evidence } = completed()
  return { ...snapshot(), verified_export: { ...evidence, teacher_id: actorId, classroom_id: classroomId, source_revision: 7 } }
}
function fixture(body: unknown = snapshot(), status = 200) {
  const requests: { url: URL; body: unknown }[] = []
  const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: new URL(String(url)), body: JSON.parse(String(init?.body)) })
    if (body instanceof Error) throw body
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://localhost:54321', 'unit-test-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  return { supabase, fetch, requests }
}
function exportInput(supabase: ReturnType<typeof fixture>['supabase']) {
  return { supabase, teacherId: actorId, classroomId, operationId, expectedSourceRevision: 7, retention, sourceAppCommit: 'abcdef1234567890', supabaseUrl: 'http://localhost:54321' }
}

describe('contextual archive recovery with installed SDK and isolated transport', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.unstubAllEnvs()
    mocks.exporter.mockResolvedValue(completed()); mocks.allowed.mockReturnValue(true)
    mocks.hotPurge.mockResolvedValue([classroomId, otherId]); mocks.coldPurge.mockResolvedValue([otherId])
  })
  afterEach(() => vi.unstubAllEnvs())

  it('encodes one snapshot RPC with server actor and no caller-owned list of classroom IDs', async () => {
    const f = fixture()
    const result = await listContextualClassroomArchiveRecovery({ supabase: f.supabase, actorId })
    expect(f.requests).toEqual([{ url: new URL('http://localhost:54321/rest/v1/rpc/read_classroom_archive_recovery_for_owner_v1'), body: { p_actor_id: actorId, p_classroom_id: null, p_operation_id: null } }])
    expect(result.hot_archive_recovery).toEqual([{ classroom_id: classroomId, current_revision: 7, export_available: true, latest_archive: null, latest_operation: null }])
    expect(result.hot_classroom_purge_enabled_ids).toEqual([classroomId]); expect(result.cold_classroom_purge_enabled_ids).toEqual([])
    expect(result.classrooms[0]).toHaveProperty('teacher_id', actorId)
    expect(result).not.toHaveProperty('verified_export')
    expect(f.fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it.each(['teacher', 'student'])('admits a %s by UUID while preserving absent/unmatched admission', async role => {
    expect(await authorizeSharedClassroomArchiveActor()).toEqual({ mode: 'existing' }); expect(mocks.auth).not.toHaveBeenCalled()
    mocks.auth.mockResolvedValue({ id: actorId, role })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [otherId] }))
    expect(await authorizeSharedClassroomArchiveActor()).toEqual({ mode: 'existing' })
    vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', JSON.stringify({ version: 1, admittedUserIds: [actorId] }))
    expect(await authorizeSharedClassroomArchiveActor()).toEqual({ mode: 'shared', user: { id: actorId, role } })
  })
  it.each(['', '{', '{}', '{"version":1,"admittedUserIds":["bad"]}'])('fails closed on malformed admission %s', async raw => {
    mocks.auth.mockResolvedValue({ id: actorId }); vi.stubEnv('PIKA_CLASSROOM_EXPERIENCE_ADMISSION', raw)
    await expect(authorizeSharedClassroomArchiveActor()).rejects.toMatchObject({ statusCode: 503 })
  })

  it.each([
    { actor_id: otherId }, { hot_classrooms: [hot(), hot()] }, { hot_classrooms: [{ ...hot(), current_revision: null }] },
    { hot_classrooms: [{ ...hot(), classroom: { ...hot().classroom, teacher_id: otherId } }] },
    { hot_classrooms: [{ ...hot(), classroom: classroom }] }, { hot_classrooms: [{ ...hot(), current_revision: Number.MAX_SAFE_INTEGER + 1 }] },
    { hot_classrooms: [{ ...hot(), latest_operation: { operation_id: operationId, classroom_id: classroomId, teacher_id: actorId, source_revision: 6, status: 'failed', retryable: false, retention, updated_at: timestamp } }] },
    { hot_classrooms: [{ ...hot(), latest_operation: { operation_id: operationId, classroom_id: classroomId, teacher_id: actorId, source_revision: 7, status: 'completed', retryable: null, retention, updated_at: timestamp } }] },
    { hot_classrooms: [{ ...hot(), latest_archive: { archive_id: archiveId, operation_id: operationId, classroom_id: otherId, teacher_id: actorId, source_revision: 7, created_at: timestamp, verified_at: timestamp, compressed_byte_size: 100, retention } }] },
    { cold_archives: [{ classroom_id: classroomId, archive_id: archiveId, title: 'Cold', archived_at: timestamp, compacted_at: timestamp, teacher_id: actorId, source_revision: 7, archive_teacher_id: actorId, archive_classroom_id: classroomId, archive_source_revision: 7 }] },
  ])('rejects substituted, active, duplicate, stale or missing bindings %#', async patch => {
    const f = fixture({ ...snapshot(), ...patch })
    await expect(listContextualClassroomArchiveRecovery({ supabase: f.supabase, actorId })).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.hotPurge).not.toHaveBeenCalled()
  })

  it.each(['PGRST202', '42P01', '42703'])('does not use legacy unfenced fallback when snapshot contract is missing %s', async code => {
    const f = fixture({ code, message: 'unavailable' }, 400)
    await expect(readContextualClassroomArchiveSnapshot({ supabase: f.supabase, actorId })).rejects.toMatchObject({ statusCode: 503 })
  })
  it('preserves historical verified archives and exactly linked completed current operations', async () => {
    const archive = { archive_id: archiveId, operation_id: operationId, classroom_id: classroomId, teacher_id: actorId, source_revision: 7, created_at: timestamp, verified_at: timestamp, compressed_byte_size: 100, retention }
    const operation = { operation_id: operationId, classroom_id: classroomId, teacher_id: actorId, source_revision: 7, status: 'completed', retryable: null, retention, updated_at: timestamp }
    const current = fixture({ ...snapshot(), hot_classrooms: [{ ...hot(), latest_archive: archive, latest_operation: operation }] })
    const result = await listContextualClassroomArchiveRecovery({ supabase: current.supabase, actorId })
    expect(result.hot_archive_recovery[0].latest_archive?.archive_id).toBe(archiveId)
    expect(result.hot_archive_recovery[0].latest_operation?.operation_id).toBe(operationId)
    expect(result.hot_archive_recovery[0].latest_archive).not.toHaveProperty('teacher_id')
    const historical = fixture({ ...snapshot(), hot_classrooms: [{ ...hot(), latest_archive: { ...archive, source_revision: 6 } }] })
    expect((await listContextualClassroomArchiveRecovery({ supabase: historical.supabase, actorId })).hot_archive_recovery[0].latest_archive?.source_revision).toBe(6)
  })
  it('accepts a cold tombstone only with the same archive owner/class/revision and strips proof fields', async () => {
    const cold = { classroom_id: otherId, archive_id: archiveId, title: 'Cold', archived_at: timestamp, compacted_at: timestamp, teacher_id: actorId, source_revision: 7, archive_teacher_id: actorId, archive_classroom_id: otherId, archive_source_revision: 7 }
    const valid = fixture({ ...snapshot(), cold_archives: [cold] })
    const result = await listContextualClassroomArchiveRecovery({ supabase: valid.supabase, actorId })
    expect(result.cold_archives).toEqual([{ classroom_id: otherId, archive_id: archiveId, title: 'Cold', archived_at: timestamp, compacted_at: timestamp }])
    for (const patch of [{ teacher_id: classroomId }, { archive_teacher_id: classroomId }, { archive_classroom_id: classroomId }, { archive_source_revision: 6 }, { archive_source_revision: null }]) {
      const f = fixture({ ...snapshot(), cold_archives: [{ ...cold, ...patch }] })
      await expect(listContextualClassroomArchiveRecovery({ supabase: f.supabase, actorId })).rejects.toMatchObject({ statusCode: 503 })
    }
  })
  it('rejects transport loss, malformed envelope and invalid target before its RPC', async () => {
    for (const body of [null, {}, [], new Error('lost')]) {
      await expect(readContextualClassroomArchiveSnapshot({ supabase: fixture(body).supabase, actorId })).rejects.toMatchObject({ statusCode: 503 })
    }
    const f = fixture()
    await expect(readContextualClassroomArchiveSnapshot({ supabase: f.supabase, actorId, classroomId: 'bad' })).rejects.toThrow()
    expect(f.fetch).not.toHaveBeenCalled()
    for (const envelope of [{ data: snapshot() }, { data: snapshot(), error: null, status: 500 }, { data: snapshot(), error: null, count: 0 }]) {
      expect(contextualArchiveSnapshotEnvelopeSchema.safeParse(envelope).success).toBe(false)
    }
  })

  it('fails closed instead of returning a silently truncated archived list', async () => {
    const rows = Array.from({ length: 5001 }, (_, index) => ({ ...hot(), classroom: {
      ...hot().classroom, id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, '0')}`,
    } }))
    expect(contextualArchiveSnapshotEnvelopeSchema.safeParse({ data: { ...snapshot(), hot_classrooms: rows.slice(0, 5000) }, error: null }).success).toBe(true)
    const f = fixture({ ...snapshot(), hot_classrooms: rows })
    await expect(listContextualClassroomArchiveRecovery({ supabase: f.supabase, actorId })).rejects.toMatchObject({ statusCode: 503 })
    expect(mocks.hotPurge).not.toHaveBeenCalled()
    expect(f.fetch).toHaveBeenCalledOnce()
  })

  it.each([false, true])('verifies exact completed export and immutable replay=%s without raw storage identity', async replayed => {
    const f = fixture(exportSnapshot()); mocks.exporter.mockResolvedValue({ ...completed(), replayed, status: replayed ? 200 : 201 })
    expect(await exportContextualClassroomArchive(exportInput(f.supabase))).toMatchObject({ ok: true, replayed })
    expect(mocks.exporter).toHaveBeenCalledOnce()
    expect(f.requests[0].body).toEqual({ p_actor_id: actorId, p_classroom_id: classroomId, p_operation_id: operationId })
  })
  it.each([
    { verified_export: null }, { hot_classrooms: [], verified_export: null },
    { hot_classrooms: [{ ...hot(), current_revision: 8 }] },
    { verified_export: { ...exportSnapshot().verified_export, classroom_id: otherId } },
    { verified_export: { ...exportSnapshot().verified_export, teacher_id: otherId } },
    { verified_export: { ...exportSnapshot().verified_export, operation_id: otherId } },
    { verified_export: { ...exportSnapshot().verified_export, archive_id: otherId } },
    { verified_export: { ...exportSnapshot().verified_export, artifact_sha256: 'c'.repeat(64) } },
  ])('reports postflight uncertainty after owner/lifecycle/revision/identity change %# without rerunning export', async patch => {
    const f = fixture({ ...exportSnapshot(), ...patch })
    await expect(exportContextualClassroomArchive(exportInput(f.supabase))).resolves.toMatchObject({ ok: false, status: 503, operation_id: operationId, error_code: 'classroom_archive_recovery_unverified' })
    expect(mocks.exporter).toHaveBeenCalledOnce(); expect(f.fetch).toHaveBeenCalledOnce()
  })
  it('preserves domain denial and rejects substituted operation failures', async () => {
    const f = fixture()
    const denied = { ok: false, status: 403, operation_id: operationId, error_code: 'classroom_forbidden', error: 'Forbidden', retryable: false }
    mocks.exporter.mockResolvedValue(denied)
    expect(await exportContextualClassroomArchive(exportInput(f.supabase))).toEqual(denied); expect(f.fetch).not.toHaveBeenCalled()
    mocks.exporter.mockResolvedValue({ ...denied, operation_id: otherId })
    await expect(exportContextualClassroomArchive(exportInput(f.supabase))).resolves.toMatchObject({ ok: false, status: 503, operation_id: operationId, error_code: 'classroom_archive_recovery_unverified' })
  })
  it('reports a lost completion acknowledgment as uncertain without another export or inferred rollback', async () => {
    const f = fixture(exportSnapshot())
    mocks.exporter.mockRejectedValue(new Error('completion acknowledgment lost'))
    expect(await exportContextualClassroomArchive(exportInput(f.supabase))).toEqual({
      ok: false, status: 503, operation_id: operationId, error_code: 'classroom_archive_recovery_unverified',
      error: 'Outcome could not be verified; refresh to reconcile it', retryable: true,
    })
    expect(mocks.exporter).toHaveBeenCalledOnce(); expect(f.fetch).not.toHaveBeenCalled()
  })
  it.each([{}, null, { ...completed(), operation_id: otherId }, { ...completed(), verification: {} }, { ...completed(), resource_counts: { classrooms: '1' } }, { ...completed(), storage_path: 'private-object' }])('does not confirm malformed coordinator result %#', async result => {
    const f = fixture(exportSnapshot()); mocks.exporter.mockResolvedValue(result)
    expect(await exportContextualClassroomArchive(exportInput(f.supabase))).toMatchObject({ ok: false, status: 503, operation_id: operationId, error_code: 'classroom_archive_recovery_unverified' })
    expect(mocks.exporter).toHaveBeenCalledOnce(); expect(f.fetch).not.toHaveBeenCalled()
  })
  it('reports lost postflight transport as uncertain after valid completion', async () => {
    const f = fixture(new Error('postflight lost'))
    expect(await exportContextualClassroomArchive(exportInput(f.supabase))).toMatchObject({ ok: false, status: 503, operation_id: operationId, error_code: 'classroom_archive_recovery_unverified' })
    expect(mocks.exporter).toHaveBeenCalledOnce(); expect(f.fetch).toHaveBeenCalledOnce()
  })
})
