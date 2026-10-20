import { createClient } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/types/database'
import { actorId, classroomId, otherId, timestamp, classroom } from '../../helpers/contextual-classroom-detail'

const mocks = vi.hoisted(() => ({ restore: vi.fn() }))
vi.mock('@/lib/server/classroom-archive-restore-operations', async original => ({
  ...await original<typeof import('@/lib/server/classroom-archive-restore-operations')>(), restoreClassroomArchive: mocks.restore,
}))
import { restoreContextualClassroomArchive } from '@/lib/server/contextual-classroom-cold-restore'
import { contextualColdRestoreReadEnvelopeSchema } from '@/lib/validations/contextual-classroom-cold-restore'

const operationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const archiveId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const verification = {
  archive_checksum_verified: true, manifest_verified: true, resource_checksums_verified: true,
  resource_counts_verified: true, storage_objects_verified: true, actor_snapshots_verified: true,
  schema_adapter_available: true, restored_storage_objects_verified: true, referential_integrity_verified: true, adapter_chain: ['v2'],
}
const completed = () => ({ ok: true, status: 201, operation_id: operationId, archive_id: archiveId, replayed: false, resource_counts: { classrooms: 1 }, verification })
const cold = () => ({ actor_id: actorId, hot_classrooms: [], cold_archives: [{
  classroom_id: classroomId, archive_id: archiveId, teacher_id: actorId, source_revision: 7,
  archive_teacher_id: actorId, archive_classroom_id: classroomId, archive_source_revision: 7,
  title: 'Cold', archived_at: timestamp, compacted_at: timestamp,
}], verified_export: null })
const hot = () => ({ actor_id: actorId, cold_archives: [], hot_classrooms: [{
  classroom: { ...classroom, archived_at: timestamp }, current_revision: 7, latest_archive: null, latest_operation: null,
}], verified_export: null })
const operation = () => ({ id: operationId, teacher_id: actorId, classroom_id: classroomId, archive_id: archiveId,
  operation_type: 'restore', status: 'completed', source_revision: 7, resource_counts: { classrooms: 1 }, source_resource_counts: { classrooms: 1 },
  verification, completed_at: timestamp, source_contract_version: 2, archive_format_version: 2, restore_contract_version: 2,
})
const operationIdentity = () => ({ id: operationId, teacher_id: actorId, classroom_id: classroomId, archive_id: archiveId, operation_type: 'restore' })
const archive = () => ({ id: archiveId, teacher_id: actorId, classroom_id: classroomId, source_revision: 7, format_version: 2, resource_counts: { classrooms: 1 } })
function fixture(responses: unknown[]) {
  const urls: URL[] = []
  const queue = [...responses]
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    urls.push(new URL(String(url)))
    const body = queue.shift()
    if (body instanceof Error) throw body
    if (body instanceof Response) return body
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const supabase = createClient<Database>('http://localhost:54321', 'test-key', { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } })
  return { supabase, urls, fetch }
}
function input(supabase: ReturnType<typeof fixture>['supabase']) {
  return { supabase, teacherId: actorId, classroomId, archiveId, operationId, databaseBudgetBytes: 123456, supabaseUrl: 'http://localhost:54321' }
}
const uncertain = { ok: false, status: 503, operation_id: operationId, error_code: 'classroom_archive_recovery_unverified', retryable: true }

describe('contextual cold restore installed SDK boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.restore.mockResolvedValue(completed()) })
  it('preflights cold current ownership before invoking the unchanged coordinator and verifies durable hot completion', async () => {
    const f = fixture([cold(), null, operation(), archive(), hot()])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toEqual(completed())
    expect(mocks.restore).toHaveBeenCalledOnce()
    expect(f.urls[0].pathname).toContain('read_classroom_archive_recovery_for_owner_v1')
    const query = f.urls.find(url => url.pathname.endsWith('classroom_archive_operations') && url.searchParams.has('teacher_id'))!
    expect(query.searchParams.get('teacher_id')).toBe(`eq.${actorId}`)
    expect(query.searchParams.get('id')).toBe(`eq.${operationId}`)
  })
  it.each([
    { actor_id: otherId }, { hot_classrooms: [], cold_archives: [] },
    { cold_archives: [{ ...cold().cold_archives[0], archive_id: otherId }] },
    { cold_archives: [{ ...cold().cold_archives[0], classroom_id: otherId }] },
    { cold_archives: [{ ...cold().cold_archives[0], teacher_id: otherId }] },
    { cold_archives: [{ ...cold().cold_archives[0], archive_source_revision: 8 }] },
  ])('denies nonowner/member/substituted target before storage, actors, reservations or mutation %#', async patch => {
    const f = fixture([{ ...cold(), ...patch }])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject({ ok: false })
    expect(mocks.restore).not.toHaveBeenCalled()
    expect(f.urls).toHaveLength(1)
  })
  it('reconciles same-key completed replay after tombstone removal from current hot owner and durable evidence', async () => {
    const f = fixture([hot(), operationIdentity(), operation(), archive(), hot()])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toEqual({ ...completed(), status: 200, replayed: true })
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it.each([{ teacher_id: otherId }, { classroom_id: otherId }, { archive_id: otherId }, { id: otherId }, { operation_type: 'export' }, { source_revision: 8 }, { verification: {} }, { completed_at: null }, { source_resource_counts: {} }])('rejects completed replay with stale/substituted/unverified ledger %#', async patch => {
    const f = fixture([hot(), operationIdentity(), { ...operation(), ...patch }, archive(), hot()])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it.each([{ teacher_id: otherId }, { classroom_id: otherId }, { archive_id: otherId }, { operation_type: 'export' }])('denies an existing operation key from another owner/class/archive/type before coordinator effects %#', async patch => {
    const f = fixture([cold(), { ...operationIdentity(), ...patch }])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject({ ok: false, status: 409, error_code: 'idempotency_conflict' })
    expect(mocks.restore).not.toHaveBeenCalled()
    expect(f.urls).toHaveLength(2)
  })
  it.each([{ ...hot(), hot_classrooms: [] }, { ...hot(), cold_archives: cold().cold_archives }, { ...hot(), hot_classrooms: [{ ...hot().hot_classrooms[0], current_revision: 8 }] }])('does not confirm postflight drift %#', async snapshot => {
    const f = fixture([cold(), null, operation(), archive(), snapshot])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).toHaveBeenCalledOnce()
  })
  it.each([null, {}, { ...completed(), operation_id: otherId }, { ...completed(), archive_id: otherId }, { ...completed(), verification: {} }, new Error('lost')])('does not confirm malformed/lost coordinator outcome %#', async result => {
    const f = fixture([cold(), null])
    if (result instanceof Error) mocks.restore.mockRejectedValue(result)
    else mocks.restore.mockResolvedValue(result)
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).toHaveBeenCalledOnce()
    expect(f.urls).toHaveLength(2)
  })
  it('preserves the operational 507 headroom failure with its extra capacity fields', async () => {
    const failure = { ok: false, status: 507, operation_id: operationId, error_code: 'classroom_archive_restore_capacity_exceeded', error: 'Insufficient database headroom', retryable: true, database_size_bytes: 100, required_headroom_bytes: 200 }
    mocks.restore.mockResolvedValue(failure)
    const f = fixture([cold(), null])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toEqual(failure)
  })
  it('turns lost postflight into same-key uncertainty without rerun or rollback claim', async () => {
    const f = fixture([cold(), null, operation(), archive(), new Error('postflight lost')])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).toHaveBeenCalledOnce()
  })
  it('rejects invalid archive identity before any request', async () => {
    const f = fixture([])
    await expect(restoreContextualClassroomArchive({ ...input(f.supabase), archiveId: 'invalid' })).rejects.toThrow()
    expect(f.fetch).not.toHaveBeenCalled()
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it.each([null, {}, { data: operationIdentity() }, { data: operationIdentity(), error: undefined }, { data: operationIdentity(), error: null, status: 500 }, { data: operationIdentity(), error: null, count: 0 }])('rejects missing or malformed SDK evidence envelopes %#', envelope => {
    expect(contextualColdRestoreReadEnvelopeSchema.safeParse(envelope).success).toBe(false)
  })
  it('returns uncertainty for a malformed JSON identity response before coordinator effects', async () => {
    const f = fixture([cold(), new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } })])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it.each([{ id: otherId }, { teacher_id: otherId }, { classroom_id: otherId }, { source_revision: 8 }, { resource_counts: { classrooms: 1, entries: 1 } }, { format_version: 1 }])('rejects immutable source evidence drift %#', async patch => {
    const f = fixture([cold(), null, operation(), { ...archive(), ...patch }, hot()])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).toHaveBeenCalledOnce()
  })
  it.each([{ resource_counts: { classrooms: 1, entries: 1 } }, { verification: { ...verification, adapter_chain: ['different'] } }])('rejects a successful result that differs from the completed durable operation %#', async patch => {
    const f = fixture([cold(), null, operation(), archive(), hot()])
    mocks.restore.mockResolvedValue({ ...completed(), ...patch })
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).toHaveBeenCalledOnce()
  })
  it('does not use a hot archive without a completed restore ledger as replay authority', async () => {
    const f = fixture([hot(), null])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).not.toHaveBeenCalled()
  })
  it('does not confirm replay if the current parent changes after reading its durable ledger', async () => {
    const f = fixture([hot(), operationIdentity(), operation(), archive(), { ...hot(), hot_classrooms: [] }])
    expect(await restoreContextualClassroomArchive(input(f.supabase))).toMatchObject(uncertain)
    expect(mocks.restore).not.toHaveBeenCalled()
  })
})
