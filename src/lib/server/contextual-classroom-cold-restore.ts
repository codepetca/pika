import { isDeepStrictEqual } from 'node:util'
import { readContextualClassroomArchiveSnapshot } from '@/lib/server/contextual-classroom-archive-recovery'
import { restoreClassroomArchive } from '@/lib/server/classroom-archive-restore-operations'
import {
  contextualColdRestoreArchiveSchema, contextualColdRestoreIdentitySchema,
  contextualColdRestoreOperationSchema, contextualColdRestoreResultSchema, contextualColdRestoreReadEnvelopeSchema,
  contextualColdRestoreRequestIdentitySchema,
} from '@/lib/validations/contextual-classroom-cold-restore'

type Input = Parameters<typeof restoreClassroomArchive>[0]
type Snapshot = Awaited<ReturnType<typeof readContextualClassroomArchiveSnapshot>>

/** Read-only admission/postflight checks do not grant a lock; existing SQL remains the mutation authority. */
export async function restoreContextualClassroomArchive(input: Input) {
  const identity = contextualColdRestoreRequestIdentitySchema.parse({ actorId: input.teacherId, classroomId: input.classroomId, operationId: input.operationId, archiveId: input.archiveId })
  const args = { ...input, teacherId: identity.actorId, classroomId: identity.classroomId, operationId: identity.operationId, archiveId: identity.archiveId }
  const failure = (status: number, code: string, error: string, retryable: boolean) => ({
    ok: false as const, status, operation_id: args.operationId, error_code: code, error, retryable,
  })
  const uncertain = () => failure(503, 'classroom_archive_recovery_unverified', 'Outcome could not be verified; refresh to reconcile it', true)
  const snapshot = () => readContextualClassroomArchiveSnapshot({ supabase: args.supabase, actorId: args.teacherId, classroomId: args.classroomId })
  const currentHot = (value: Snapshot, revision: number) => value.cold_archives.length === 0
    && value.hot_classrooms.length === 1 && value.hot_classrooms[0].classroom.id === args.classroomId
    && value.hot_classrooms[0].current_revision === revision

  async function completedEvidence(expectedRevision: number) {
    const response = await args.supabase.from('classroom_archive_operations')
      .select('id,teacher_id,classroom_id,archive_id,operation_type,status,source_revision,resource_counts,source_resource_counts,verification,completed_at,source_contract_version,archive_format_version,restore_contract_version')
      .eq('id', args.operationId).eq('teacher_id', args.teacherId).eq('classroom_id', args.classroomId)
      .eq('archive_id', args.archiveId).eq('operation_type', 'restore').eq('status', 'completed')
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    const operation = contextualColdRestoreOperationSchema.parse(contextualColdRestoreReadEnvelopeSchema.parse(response).data)
    if (operation.id !== args.operationId || operation.teacher_id !== args.teacherId || operation.classroom_id !== args.classroomId
      || operation.archive_id !== args.archiveId || operation.source_revision !== expectedRevision) throw new Error('Unbound restore operation')
    const archiveResponse = await args.supabase.from('classroom_archives')
      .select('id,teacher_id,classroom_id,source_revision,format_version,resource_counts')
      .eq('id', args.archiveId).eq('teacher_id', args.teacherId).eq('classroom_id', args.classroomId)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    const archive = contextualColdRestoreArchiveSchema.parse(contextualColdRestoreReadEnvelopeSchema.parse(archiveResponse).data)
    if (archive.id !== args.archiveId || archive.teacher_id !== args.teacherId || archive.classroom_id !== args.classroomId
      || archive.source_revision !== expectedRevision || archive.format_version !== operation.archive_format_version
      || operation.source_contract_version !== operation.archive_format_version
      || !isDeepStrictEqual(archive.resource_counts, operation.source_resource_counts)) throw new Error('Unbound restore archive')
    return operation
  }

  try {
    const before = await snapshot()
    const cold = before.cold_archives.find(row => row.classroom_id === args.classroomId && row.archive_id === args.archiveId)
    const hot = before.hot_classrooms.find(row => row.classroom.id === args.classroomId)
    if (!cold && !hot) return failure(404, 'classroom_archive_not_found', 'Classroom archive not found', false)
    // Minimal exact-key lookup mirrors begin's conflict check without exposing another owner's ledger.
    const lookup = await args.supabase.from('classroom_archive_operations')
      .select('id,teacher_id,classroom_id,archive_id,operation_type').eq('id', args.operationId)
      .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
    const existingData = contextualColdRestoreReadEnvelopeSchema.parse(lookup).data
    const existing = existingData === null ? null : contextualColdRestoreIdentitySchema.parse(existingData)
    if (existing && (existing.id !== args.operationId || existing.teacher_id !== args.teacherId
      || existing.classroom_id !== args.classroomId || existing.archive_id !== args.archiveId || existing.operation_type !== 'restore')) {
      return failure(409, 'idempotency_conflict', 'Operation key conflicts with this restore request', false)
    }
    if (!cold) {
      if (!existing || !hot) return uncertain()
      const operation = await completedEvidence(hot.current_revision)
      if (!currentHot(await snapshot(), operation.source_revision)) return uncertain()
      return { ok: true as const, status: 200 as const, operation_id: args.operationId, archive_id: args.archiveId,
        replayed: true, resource_counts: operation.resource_counts, verification: operation.verification }
    }

    const raw: unknown = await restoreClassroomArchive(args)
    const result = contextualColdRestoreResultSchema.parse(raw)
    if (result.operation_id !== args.operationId || (result.ok && result.archive_id !== args.archiveId)) return uncertain()
    if (!result.ok) return result.status === 503 ? uncertain() : result
    const operation = await completedEvidence(cold.source_revision)
    if (!isDeepStrictEqual(operation.resource_counts, result.resource_counts)
      || !isDeepStrictEqual(operation.verification, result.verification)) return uncertain()
    if (!currentHot(await snapshot(), cold.source_revision)) return uncertain()
    return result
  } catch { return uncertain() }
}
