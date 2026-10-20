import { isDeepStrictEqual } from 'node:util'
import { ApiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth'
import type { AuthenticatedUser } from '@/types'
import type { getServiceRoleClient } from '@/lib/supabase'
import { hydrateClassroomRecords } from '@/lib/server/classrooms'
import { isClassroomExperienceAdmissionConfigured, resolveClassroomExperienceAdmission } from '@/lib/server/classroom-experience-admission'
import { exportClassroomArchive, isClassroomArchiveExportAllowed } from '@/lib/server/classroom-archive-operations'
import { isClassroomArchiveRestoreAllowed, resolveClassroomArchiveRestoreDatabaseBudget } from '@/lib/server/classroom-archive-restore-operations'
import { listColdClassroomPurgeEnabledIds, listHotClassroomPurgeEnabledIds } from '@/lib/server/classroom-purge-availability'
import { contextualArchiveIdentitySchema, contextualArchiveSnapshotEnvelopeSchema, contextualArchiveExportResultSchema } from '@/lib/validations/contextual-classroom-archive-recovery'

type ServiceClient = ReturnType<typeof getServiceRoleClient>
const unavailable = () => new ApiError(503, 'Classroom archive recovery is unavailable; refresh to reconcile its outcome')

/** Admission selects a boundary only; ownership is independently established by SQL. */
export async function authorizeSharedClassroomArchiveActor(): Promise<{ mode: 'existing' } | { mode: 'shared'; user: AuthenticatedUser }> {
  if (!isClassroomExperienceAdmissionConfigured()) return { mode: 'existing' }
  const user = await requireAuth()
  return resolveClassroomExperienceAdmission(user).status === 'admitted' ? { mode: 'shared', user } : { mode: 'existing' }
}

export async function readContextualClassroomArchiveSnapshot(input: {
  supabase: ServiceClient; actorId: string; classroomId?: string; operationId?: string
}) {
  const identity = contextualArchiveIdentitySchema.parse({ actorId: input.actorId, classroomId: input.classroomId, operationId: input.operationId })
  let response: unknown
  try {
    response = await input.supabase.rpc('read_classroom_archive_recovery_for_owner_v1', {
      p_actor_id: identity.actorId, p_classroom_id: identity.classroomId ?? null, p_operation_id: identity.operationId ?? null,
    }).abortSignal(AbortSignal.timeout(10_000))
  } catch { throw unavailable() }
  let parsed: ReturnType<typeof contextualArchiveSnapshotEnvelopeSchema.safeParse>
  try { parsed = contextualArchiveSnapshotEnvelopeSchema.safeParse(response) } catch { throw unavailable() }
  if (!parsed.success || parsed.data.data.actor_id !== identity.actorId) throw unavailable()
  const snapshot = parsed.data.data
  if (identity.classroomId && (snapshot.hot_classrooms.some(row => row.classroom.id !== identity.classroomId)
    || snapshot.cold_archives.some(row => row.classroom_id !== identity.classroomId))) throw unavailable()
  if (snapshot.verified_export && (!identity.operationId || snapshot.verified_export.operation_id !== identity.operationId
    || snapshot.verified_export.classroom_id !== identity.classroomId)) throw unavailable()
  return snapshot
}

export async function listContextualClassroomArchiveRecovery(input: { supabase: ServiceClient; actorId: string }) {
  const snapshot = await readContextualClassroomArchiveSnapshot(input)
  const hotIds = snapshot.hot_classrooms.map(row => row.classroom.id)
  const coldIds = snapshot.cold_archives.map(row => row.classroom_id)
  const hotIdSet = new Set(hotIds)
  const coldIdSet = new Set(coldIds)
  const [hotPurgeIds, coldPurgeIds] = await Promise.all([
    listHotClassroomPurgeEnabledIds({ supabase: input.supabase, teacherId: snapshot.actor_id, hotClassroomIds: hotIds }),
    listColdClassroomPurgeEnabledIds({ supabase: input.supabase, teacherId: snapshot.actor_id, coldClassroomIds: coldIds }),
  ])
  let restoreEnabled = false
  if (isClassroomArchiveRestoreAllowed(snapshot.actor_id)) {
    try { resolveClassroomArchiveRestoreDatabaseBudget(); restoreEnabled = true } catch { /* Existing operational budget gate. */ }
  }
  return {
    classrooms: hydrateClassroomRecords(snapshot.hot_classrooms.map(row => row.classroom)),
    cold_archives: snapshot.cold_archives.map(({ teacher_id: _owner, source_revision: _revision, archive_teacher_id: _archiveOwner, archive_classroom_id: _archiveClass, archive_source_revision: _archiveRevision, ...summary }) => summary),
    cold_archive_restore_enabled: restoreEnabled,
    hot_classroom_purge_enabled_ids: hotPurgeIds.filter(id => hotIdSet.has(id)),
    cold_classroom_purge_enabled_ids: coldPurgeIds.filter(id => coldIdSet.has(id)),
    hot_archive_recovery: snapshot.hot_classrooms.map(row => ({
      classroom_id: row.classroom.id, current_revision: row.current_revision,
      export_available: isClassroomArchiveExportAllowed(snapshot.actor_id),
      latest_archive: row.latest_archive && (({ teacher_id: _owner, classroom_id: _class, ...summary }) => summary)(row.latest_archive),
      latest_operation: row.latest_operation && (({ teacher_id: _owner, classroom_id: _class, ...summary }) => summary)(row.latest_operation),
    })),
    hot_archive_recovery_status_available: true,
  }
}

/** The existing coordinator owns strict stored-byte verification, begin/finalize and cleanup. */
export async function exportContextualClassroomArchive(input: Parameters<typeof exportClassroomArchive>[0] & { expectedSourceRevision: number }) {
  const identity = contextualArchiveIdentitySchema.parse({ actorId: input.teacherId, classroomId: input.classroomId, operationId: input.operationId })
  const uncertain = () => ({
    ok: false as const, status: 503 as const, operation_id: identity.operationId!,
    error_code: 'classroom_archive_recovery_unverified',
    error: 'Outcome could not be verified; refresh to reconcile it', retryable: true,
  })
  let result: unknown
  try { result = await exportClassroomArchive({ ...input, teacherId: identity.actorId, classroomId: identity.classroomId!, operationId: identity.operationId! }) }
  catch { return uncertain() }
  let parsed: ReturnType<typeof contextualArchiveExportResultSchema.safeParse>
  try { parsed = contextualArchiveExportResultSchema.safeParse(result) } catch { return uncertain() }
  if (!parsed.success || parsed.data.operation_id !== identity.operationId) return uncertain()
  if (!parsed.data.ok) return parsed.data
  // Read-only postflight: uncertainty must never trigger deletion, retry or a rollback claim.
  try {
    const snapshot = await readContextualClassroomArchiveSnapshot({ supabase: input.supabase, ...identity })
    const evidence = snapshot.verified_export
    if (!evidence || evidence.source_revision !== input.expectedSourceRevision) return uncertain()
    const { teacher_id: _owner, classroom_id: _class, source_revision: _revision, ...verified } = evidence
    const { ok: _ok, status: _status, replayed: _replayed, ...completed } = parsed.data
    if (!isDeepStrictEqual(verified, completed)) return uncertain()
  } catch { return uncertain() }
  return parsed.data
}
