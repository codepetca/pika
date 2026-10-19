import { z } from 'zod'
import { classroomColdArchiveSummarySchema, classroomHotArchiveVerifiedCopySchema, classroomHotArchiveOperationSummarySchema } from '@/lib/contracts/classroom-lifecycle'
import { contextualClassroomDetailRowSchema } from '@/lib/validations/contextual-classroom-detail'

const uuid = z.string().uuid().refine(value => value === value.toLowerCase())
const revision = z.number().int().nonnegative().safe()
const boundIdentity = { teacher_id: uuid, classroom_id: uuid }
const counts = z.record(z.string(), z.number().int().nonnegative().safe())
const verification = z.object({
  read_back_verified: z.literal(true), artifact_checksum_verified: z.literal(true),
  manifest_verified: z.literal(true), resource_checksums_verified: z.literal(true),
  resource_counts_verified: z.literal(true), storage_objects_verified: z.literal(true),
  actor_snapshots_verified: z.literal(true), verified_at: z.string().datetime({ offset: true }),
}).strict()

export const contextualArchiveIdentitySchema = z.object({
  actorId: z.string().uuid().transform(value => value.toLowerCase()),
  classroomId: z.string().uuid().transform(value => value.toLowerCase()).optional(),
  operationId: z.string().uuid().transform(value => value.toLowerCase()).optional(),
}).strict().refine(value => !value.operationId || !!value.classroomId)

export const contextualArchiveExportResultSchema = z.union([
  z.object({
    ok: z.literal(false), status: z.number().int().min(400).max(599), operation_id: uuid,
    error_code: z.string().min(1), error: z.string().min(1), retryable: z.boolean(),
  }).strict(),
  z.object({
    ok: z.literal(true), status: z.union([z.literal(200), z.literal(201)]),
    operation_id: uuid, archive_id: uuid, replayed: z.boolean(),
    artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/), content_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    compressed_byte_size: z.number().int().positive().safe(), uncompressed_byte_size: z.number().int().positive().safe(),
    resource_counts: counts, storage_object_counts: z.record(z.string(), z.json()), verification,
  }).strict(),
])
const completedExport = contextualArchiveExportResultSchema.options[1].omit({ ok: true, status: true, replayed: true }).extend({
  ...boundIdentity, source_revision: revision,
}).strict()

export const contextualArchiveSnapshotSchema = z.object({
  actor_id: uuid,
  hot_classrooms: z.array(z.object({
    classroom: contextualClassroomDetailRowSchema,
    current_revision: revision,
    latest_archive: classroomHotArchiveVerifiedCopySchema.extend({
      ...boundIdentity, archive_id: uuid, operation_id: uuid, source_revision: revision,
      compressed_byte_size: z.number().int().positive().safe(),
    }).strict().nullable(),
    latest_operation: classroomHotArchiveOperationSummarySchema.extend({ ...boundIdentity, operation_id: uuid, source_revision: revision }).strict().nullable(),
  }).strict()).max(5000),
  cold_archives: z.array(classroomColdArchiveSummarySchema.extend({
    classroom_id: uuid, archive_id: uuid, teacher_id: uuid, source_revision: revision,
    archive_teacher_id: uuid, archive_classroom_id: uuid, archive_source_revision: revision,
  }).strict()).max(5000),
  verified_export: completedExport.nullable(),
}).strict().superRefine((snapshot, context) => {
  const invalid = () => context.addIssue({ code: 'custom', message: 'Archive recovery evidence is not bound to its current owner and source' })
  const classIds = new Set<string>()
  const archiveIds = new Set<string>()
  const operationClasses = new Map<string, string>()
  for (const hot of snapshot.hot_classrooms) {
    const id = hot.classroom.id
    if (classIds.has(id) || hot.classroom.teacher_id !== snapshot.actor_id || hot.classroom.archived_at === null) invalid()
    classIds.add(id)
    for (const row of [hot.latest_archive, hot.latest_operation]) {
      if (row && (row.teacher_id !== snapshot.actor_id || row.classroom_id !== id || row.source_revision > hot.current_revision)) invalid()
    }
    const archive = hot.latest_archive
    const operation = hot.latest_operation
    if (archive) {
      if (archiveIds.has(archive.archive_id) || (operationClasses.has(archive.operation_id) && operationClasses.get(archive.operation_id) !== id)) invalid()
      archiveIds.add(archive.archive_id)
      operationClasses.set(archive.operation_id, id)
    }
    if (operation) {
      if (operation.source_revision !== hot.current_revision
        || (operationClasses.has(operation.operation_id) && operationClasses.get(operation.operation_id) !== id)
        || (archive?.operation_id === operation.operation_id && operation.status !== 'completed')) invalid()
      operationClasses.set(operation.operation_id, id)
    }
    if (operation?.status === 'completed' && (!archive || archive.operation_id !== operation.operation_id || archive.source_revision !== operation.source_revision)) invalid()
  }
  for (const cold of snapshot.cold_archives) {
    if (classIds.has(cold.classroom_id) || archiveIds.has(cold.archive_id)
      || cold.teacher_id !== snapshot.actor_id || cold.archive_teacher_id !== snapshot.actor_id
      || cold.archive_classroom_id !== cold.classroom_id || cold.archive_source_revision !== cold.source_revision) invalid()
    classIds.add(cold.classroom_id)
    archiveIds.add(cold.archive_id)
  }
  const exported = snapshot.verified_export
  if (exported) {
    const hot = snapshot.hot_classrooms.find(row => row.classroom.id === exported.classroom_id)
    if (!hot || exported.teacher_id !== snapshot.actor_id || exported.source_revision !== hot.current_revision) invalid()
  }
})

export const contextualArchiveSnapshotEnvelopeSchema = z.unknown().refine(value => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
  && Object.hasOwn(value, 'data') && Object.hasOwn(value, 'error')
)).pipe(z.object({
  data: contextualArchiveSnapshotSchema, error: z.null(),
  count: z.number().int().nullable().optional(),
  status: z.number().int().min(200).max(299).optional(), statusText: z.string().optional(),
}).strict().refine(value => value.count === undefined || value.count === null || value.count === 1))
