import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  CLASSROOM_ARCHIVE_V1_RESOURCES,
  CLASSROOM_ARCHIVE_V1_RESTORE_ORDER,
} from '@/lib/contracts/classroom-archive-resources'
import { classroomArchiveRestoreVerificationSchema } from '@/lib/contracts/classroom-lifecycle'
import {
  canonicalJsonStringify,
  decodeClassroomArchiveData,
  sha256Bytes,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import {
  buildClassroomArchiveRestorePlan,
  CLASSROOM_ARCHIVE_RESTORE_TARGET_MIGRATION,
  type ClassroomArchiveRestorePlan,
} from '@/lib/server/classroom-archive-restore'
import { getServiceRoleClient } from '@/lib/supabase'
import { parseDatabaseJson } from '@/lib/validations/database-json'

const CLASSROOM_ARCHIVE_BUCKET = 'classroom-archives' as const
const STAGING_BATCH_MAX_BYTES = 900 * 1024
const STAGING_BATCH_MAX_ROWS = 250

const uuidSchema = z.string().uuid()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const resourceCountsSchema = z.record(z.string(), z.number().int().nonnegative())
const archiveMetadataSchema = z.object({
  id: uuidSchema,
  classroom_id: uuidSchema,
  teacher_id: uuidSchema,
  storage_bucket: z.literal(CLASSROOM_ARCHIVE_BUCKET),
  storage_path: z.string().min(1),
  artifact_sha256: sha256Schema,
  content_sha256: sha256Schema,
  compressed_byte_size: z.number().int().positive(),
  uncompressed_byte_size: z.number().int().positive(),
  resource_counts: resourceCountsSchema,
}).strict()

const operationFailureSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(599),
  operation_id: uuidSchema,
  error_code: z.string().min(1),
  error: z.string().min(1),
  retryable: z.boolean(),
  database_size_bytes: z.number().int().nonnegative().optional(),
  required_headroom_bytes: z.number().int().nonnegative().optional(),
}).strict()

const beginRestoreSchema = z.union([
  operationFailureSchema,
  z.object({
    ok: z.literal(true),
    status: z.literal(202),
    operation_id: uuidSchema,
    archive_id: uuidSchema,
    operation_status: z.literal('snapshot_ready'),
    replayed: z.boolean(),
    resource_counts: resourceCountsSchema,
    snapshot_expires_at: z.string().datetime({ offset: true }),
    database_size_bytes: z.number().int().nonnegative(),
    required_headroom_bytes: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    ok: z.literal(true),
    status: z.literal(200),
    operation_id: uuidSchema,
    archive_id: uuidSchema,
    operation_status: z.literal('completed'),
    replayed: z.literal(true),
    resource_counts: resourceCountsSchema,
    verification: z.record(z.string(), z.unknown()),
  }).strict(),
])

const stageRestoreSchema = z.union([
  operationFailureSchema,
  z.object({
    ok: z.literal(true),
    status: z.literal(202),
    operation_id: uuidSchema,
    table_name: z.string().min(1),
    staged_count: z.number().int().nonnegative(),
    expected_count: z.number().int().nonnegative(),
  }).strict(),
])

const restoreFinalizeEvidenceSchema = z.object({
  archive_checksum_verified: z.literal(true),
  manifest_verified: z.literal(true),
  resource_checksums_verified: z.literal(true),
  resource_counts_verified: z.literal(true),
  storage_objects_verified: z.literal(true),
  actor_snapshots_verified: z.literal(true),
  schema_adapter_available: z.literal(true),
  restored_storage_objects_verified: z.literal(true),
  adapter_chain: z.array(z.string().min(1)),
}).strict()

const completeRestoreSchema = z.union([
  operationFailureSchema,
  z.object({
    ok: z.literal(true),
    status: z.union([z.literal(200), z.literal(201)]),
    operation_id: uuidSchema,
    archive_id: uuidSchema,
    operation_status: z.literal('completed'),
    replayed: z.boolean(),
    resource_counts: resourceCountsSchema,
    verification: classroomArchiveRestoreVerificationSchema,
  }).strict(),
])

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type OperationFailure = z.infer<typeof operationFailureSchema>

export type ClassroomArchiveRestoreResult =
  | {
      ok: true
      status: 200 | 201
      operation_id: string
      archive_id: string
      replayed: boolean
      resource_counts: Record<string, number>
      verification: z.infer<typeof classroomArchiveRestoreVerificationSchema>
    }
  | OperationFailure

class ClassroomArchiveRestoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ClassroomArchiveRestoreError'
  }
}

function isMissingRestoreRpc(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error && (
      error.code === 'PGRST202' ||
      error.code === '42883' ||
      error.message?.includes('begin_classroom_archive_restore')
    ),
  )
}

function publicFailure(args: {
  operationId: string
  code: string
  message: string
  status: number
  retryable: boolean
}): OperationFailure {
  return {
    ok: false,
    status: args.status,
    operation_id: args.operationId,
    error_code: args.code,
    error: args.message,
    retryable: args.retryable,
  }
}

export function resolveClassroomArchiveRestoreOperationId(
  value: string | null | undefined,
): string {
  return value ? uuidSchema.parse(value.trim()) : randomUUID()
}

export function resolveClassroomArchiveRestoreDatabaseBudget(): number {
  const value = process.env.CLASSROOM_ARCHIVE_RESTORE_DATABASE_BUDGET_BYTES?.trim()
  if (!value || !/^\d+$/.test(value)) {
    throw new Error('Classroom archive restore database budget is unavailable')
  }
  const budget = Number(value)
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    throw new Error('Classroom archive restore database budget is invalid')
  }
  return budget
}

export function isClassroomArchiveRestoreAllowed(teacherId: string): boolean {
  if (process.env.CLASSROOM_ARCHIVE_RESTORE_ENABLED?.trim().toLowerCase() !== 'true') {
    return false
  }
  const parsedTeacherId = uuidSchema.parse(teacherId)
  return (process.env.CLASSROOM_ARCHIVE_RESTORE_TEACHER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => value === parsedTeacherId)
}

function hashRestoreRequest(args: {
  archiveId: string
  classroomId: string
  targetSchemaMigration: string
  storageObjects: Array<Record<string, unknown>>
}): string {
  return createHash('sha256').update(canonicalJsonStringify({
    operation: 'classroom_archive_restore',
    archive_id: args.archiveId,
    classroom_id: args.classroomId,
    target_schema_migration: args.targetSchemaMigration,
    storage_objects: args.storageObjects,
  })).digest('hex')
}

function exactResourceCounts(plan: ClassroomArchiveRestorePlan): Record<string, number> {
  return Object.fromEntries(
    CLASSROOM_ARCHIVE_V1_RESOURCES.map((resource) => [
      resource.table,
      plan.resources[resource.table]?.length || 0,
    ]),
  )
}

async function readStorageBytes(blob: Blob | null): Promise<Uint8Array | null> {
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

async function loadArchiveMetadata(args: {
  supabase: SupabaseClient
  archiveId: string
  classroomId: string
  teacherId: string
}) {
  const response = await args.supabase
    .from('classroom_archives')
    .select([
      'id',
      'classroom_id',
      'teacher_id',
      'storage_bucket',
      'storage_path',
      'artifact_sha256',
      'content_sha256',
      'compressed_byte_size',
      'uncompressed_byte_size',
      'resource_counts',
    ].join(','))
    .eq('id', args.archiveId)
    .eq('classroom_id', args.classroomId)
    .eq('teacher_id', args.teacherId)
    .single()
  if (response.error && response.error.code !== 'PGRST116') {
    throw new ClassroomArchiveRestoreError(
      'classroom_archive_metadata_read_failed',
      'Classroom archive metadata could not be read',
      503,
      true,
    )
  }
  if (!response.data) {
    throw new ClassroomArchiveRestoreError(
      'classroom_archive_not_found',
      'Classroom archive not found',
      404,
      false,
    )
  }
  return archiveMetadataSchema.parse(response.data)
}

async function loadCurrentActors(
  supabase: SupabaseClient,
  actorIds: string[],
): Promise<Array<{ id: string; email: string; role: 'student' | 'teacher' }>> {
  const actors: unknown[] = []
  for (let offset = 0; offset < actorIds.length; offset += 200) {
    const response = await supabase
      .from('users')
      .select('id,email,role')
      .in('id', actorIds.slice(offset, offset + 200))
    if (response.error) {
      throw new ClassroomArchiveRestoreError(
        'restore_actor_reconciliation_failed',
        'Classroom archive actors could not be reconciled',
        503,
        true,
      )
    }
    actors.push(...(response.data || []))
  }
  return z.array(z.object({
    id: uuidSchema,
    email: z.string().email(),
    role: z.enum(['student', 'teacher']),
  }).strict()).parse(actors)
}

function chunkRestoreRows(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  const chunks: Record<string, unknown>[][] = []
  let chunk: Record<string, unknown>[] = []
  for (const row of rows) {
    const singleRowBytes = Buffer.byteLength(JSON.stringify([row]))
    if (singleRowBytes > STAGING_BATCH_MAX_BYTES) {
      throw new ClassroomArchiveRestoreError(
        'restore_row_exceeds_staging_limit',
        'A classroom archive row exceeds the restore staging limit',
        413,
        false,
      )
    }
    const candidate = [...chunk, row]
    if (
      chunk.length > 0 && (
        candidate.length > STAGING_BATCH_MAX_ROWS ||
        Buffer.byteLength(JSON.stringify(candidate)) > STAGING_BATCH_MAX_BYTES
      )
    ) {
      chunks.push(chunk)
      chunk = [row]
    } else {
      chunk = candidate
    }
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}

async function uploadAndVerifyRestoreObject(args: {
  supabase: SupabaseClient
  object: ClassroomArchiveRestorePlan['storageObjects'][number]
}): Promise<boolean> {
  const bucket = args.supabase.storage.from(args.object.bucket)
  let bytes: Uint8Array | null = null
  try {
    bytes = await readStorageBytes((await bucket.download(args.object.restorePath)).data)
  } catch {
    // An upload conflict plus read-back below can still reconcile an existing object.
  }
  let uploaded = false
  if (!bytes) {
    const upload = await bucket.upload(args.object.restorePath, args.object.bytes, {
      contentType: args.object.contentType || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    })
    if (upload.error) {
      try {
        const readBack = await bucket.download(args.object.restorePath)
        bytes = await readStorageBytes(readBack.data)
        if (readBack.error || !bytes) throw new Error('read-back unavailable')
      } catch {
        throw new ClassroomArchiveRestoreError(
          'restore_storage_upload_failed',
          'A classroom archive object could not be restored',
          503,
          true,
        )
      }
    } else {
      uploaded = true
      try {
        const readBack = await bucket.download(args.object.restorePath)
        bytes = await readStorageBytes(readBack.data)
        if (readBack.error || !bytes) throw new Error('read-back unavailable')
      } catch {
        throw new ClassroomArchiveRestoreError(
          'restore_storage_readback_failed',
          'A restored classroom object could not be read back for verification',
          503,
          true,
        )
      }
    }
  }
  if (sha256Bytes(bytes) !== args.object.sha256) {
    if (uploaded) {
      try {
        await bucket.remove([args.object.restorePath])
      } catch {
        // The staged upload intent leaves cleanup durable if best-effort removal fails.
      }
    }
    throw new ClassroomArchiveRestoreError(
      'restore_storage_checksum_mismatch',
      'A restored classroom object failed checksum verification',
      409,
      false,
    )
  }
  return uploaded
}

async function recordRestoreFailure(args: {
  supabase: SupabaseClient
  operationId: string
  teacherId: string
  error: ClassroomArchiveRestoreError
}): Promise<boolean> {
  try {
    const response = await args.supabase.rpc('fail_classroom_archive_restore', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_error_code: args.error.code,
      p_retryable: args.error.retryable,
    })
    return !response.error && response.data === true
  } catch {
    return false
  }
}

function emitRestoreMetric(result: ClassroomArchiveRestoreResult, startedAt: number) {
  console.info('[classroom-archive-operation]', JSON.stringify({
    operation_id: result.operation_id,
    operation_type: 'restore',
    status: result.ok ? 'completed' : 'failed',
    replayed: result.ok ? result.replayed : false,
    duration_ms: Date.now() - startedAt,
    resource_counts: result.ok ? result.resource_counts : undefined,
    error_code: result.ok ? undefined : result.error_code,
    retryable: result.ok ? undefined : result.retryable,
  }))
}

export async function restoreClassroomArchive(args: {
  supabase: SupabaseClient
  operationId: string
  archiveId: string
  teacherId: string
  classroomId: string
  databaseBudgetBytes: number
  supabaseUrl: string
}): Promise<ClassroomArchiveRestoreResult> {
  const startedAt = Date.now()
  let operationStarted = false
  let finalizationAttempted = false
  let plan: ClassroomArchiveRestorePlan | null = null
  const uploadedStorageObjects: Array<{ bucket: string; path: string }> = []

  try {
    const metadata = await loadArchiveMetadata(args)
    const archiveDownload = await args.supabase.storage
      .from(metadata.storage_bucket)
      .download(metadata.storage_path)
    const archiveBytes = await readStorageBytes(archiveDownload.data)
    if (archiveDownload.error || !archiveBytes) {
      throw new ClassroomArchiveRestoreError(
        'classroom_archive_download_failed',
        'Classroom archive could not be read',
        503,
        true,
      )
    }
    const artifactChecksumVerified = sha256Bytes(archiveBytes) === metadata.artifact_sha256
    if (!artifactChecksumVerified || archiveBytes.byteLength !== metadata.compressed_byte_size) {
      throw new ClassroomArchiveRestoreError(
        'classroom_archive_artifact_mismatch',
        'Classroom archive artifact does not match verified metadata',
        409,
        false,
      )
    }
    const verified = verifyClassroomArchiveBundle(archiveBytes)
    if (!verified.ok) {
      throw new ClassroomArchiveRestoreError(
        'classroom_archive_verification_failed',
        'Classroom archive failed strict verification',
        409,
        false,
      )
    }
    if (
      verified.manifest.archive_id !== metadata.id ||
      verified.manifest.classroom_id !== metadata.classroom_id ||
      verified.manifest.teacher_id !== metadata.teacher_id ||
      verified.manifest.content_sha256 !== metadata.content_sha256
    ) {
      throw new ClassroomArchiveRestoreError(
        'classroom_archive_identity_mismatch',
        'Classroom archive identity does not match verified metadata',
        409,
        false,
      )
    }
    const decoded = decodeClassroomArchiveData(verified)
    const currentActors = await loadCurrentActors(
      args.supabase,
      decoded.actors.map((actor) => actor.id),
    )
    plan = buildClassroomArchiveRestorePlan({
      verified,
      artifactChecksumVerified,
      operationId: args.operationId,
      currentActors,
      supabaseUrl: args.supabaseUrl,
    })
    const resourceCounts = exactResourceCounts(plan)
    const storageObjects = plan.storageObjects.map((object) => ({
      storage_bucket: object.bucket,
      storage_path: object.restorePath,
      expected_sha256: object.sha256,
      expected_byte_size: object.bytes.byteLength,
    })).sort((left, right) => (
      left.storage_bucket.localeCompare(right.storage_bucket)
      || left.storage_path.localeCompare(right.storage_path)
    ))
    if (canonicalJsonStringify(resourceCounts) !== canonicalJsonStringify(metadata.resource_counts)) {
      throw new ClassroomArchiveRestoreError(
        'classroom_archive_resource_count_mismatch',
        'Classroom archive resource counts do not match verified metadata',
        409,
        false,
      )
    }
    const beginResponse = await args.supabase.rpc('begin_classroom_archive_restore', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_classroom_id: args.classroomId,
      p_archive_id: args.archiveId,
      p_request_sha256: hashRestoreRequest({
        archiveId: args.archiveId,
        classroomId: args.classroomId,
        targetSchemaMigration: plan.targetSchemaMigration,
        storageObjects,
      }),
      p_target_schema_migration: plan.targetSchemaMigration,
      p_adapter_chain: plan.adapterChain,
      p_resource_counts: resourceCounts,
      p_storage_objects: storageObjects,
      p_database_budget_bytes: args.databaseBudgetBytes,
    })
    if (beginResponse.error) {
      throw new ClassroomArchiveRestoreError(
        isMissingRestoreRpc(beginResponse.error)
          ? 'classroom_archive_restore_migration_required'
          : 'classroom_archive_restore_begin_failed',
        isMissingRestoreRpc(beginResponse.error)
          ? 'Classroom archive restore requires migration 083'
          : 'Classroom archive restore could not start',
        503,
        true,
      )
    }
    const parsedBegin = beginRestoreSchema.safeParse(beginResponse.data)
    if (!parsedBegin.success) {
      throw new ClassroomArchiveRestoreError(
        'classroom_archive_restore_begin_contract_invalid',
        'Classroom archive restore returned an invalid begin contract',
        503,
        true,
      )
    }
    const begin = parsedBegin.data
    if (!begin.ok) {
      emitRestoreMetric(begin, startedAt)
      return begin
    }
    if (begin.operation_status === 'completed') {
      const result: ClassroomArchiveRestoreResult = {
        ok: true,
        status: 200,
        operation_id: begin.operation_id,
        archive_id: begin.archive_id,
        replayed: true,
        resource_counts: begin.resource_counts,
        verification: classroomArchiveRestoreVerificationSchema.parse(begin.verification),
      }
      emitRestoreMetric(result, startedAt)
      return result
    }
    operationStarted = true

    for (const object of plan.storageObjects) {
      const uploadIntentResponse = await args.supabase.rpc(
        'stage_classroom_archive_object_upload',
        {
          p_operation_id: args.operationId,
          p_teacher_id: args.teacherId,
          p_storage_bucket: object.bucket,
          p_storage_path: object.restorePath,
          p_expected_sha256: object.sha256,
          p_expected_byte_size: object.bytes.byteLength,
        },
      )
      const uploadIntent = !uploadIntentResponse.error
        ? z.boolean().safeParse(uploadIntentResponse.data)
        : null
      if (!uploadIntent || !uploadIntent.success || !uploadIntent.data) {
        throw new ClassroomArchiveRestoreError(
          'classroom_archive_restore_object_intent_failed',
          'Classroom archive restore object upload could not be staged',
          503,
          true,
        )
      }
      const uploaded = await uploadAndVerifyRestoreObject({ supabase: args.supabase, object })
      if (uploaded) {
        uploadedStorageObjects.push({ bucket: object.bucket, path: object.restorePath })
      }
    }
    for (const table of CLASSROOM_ARCHIVE_V1_RESTORE_ORDER) {
      const rows = plan.resources[table] || []
      for (const chunk of chunkRestoreRows(rows)) {
        const response = await args.supabase.rpc('stage_classroom_archive_restore_rows', {
          p_operation_id: args.operationId,
          p_teacher_id: args.teacherId,
          p_table_name: table,
          p_rows: parseDatabaseJson(chunk),
        })
        if (response.error) {
          throw new ClassroomArchiveRestoreError(
            'classroom_archive_restore_staging_failed',
            'Classroom archive rows could not be staged',
            503,
            true,
          )
        }
        const parsedStage = stageRestoreSchema.safeParse(response.data)
        if (!parsedStage.success) {
          throw new ClassroomArchiveRestoreError(
            'classroom_archive_restore_staging_contract_invalid',
            'Classroom archive restore returned an invalid staging contract',
            503,
            true,
          )
        }
        const staged = parsedStage.data
        if (!staged.ok) {
          throw new ClassroomArchiveRestoreError(
            staged.error_code,
            staged.error,
            staged.status,
            staged.retryable,
          )
        }
      }
    }

    const verification = restoreFinalizeEvidenceSchema.parse({
      archive_checksum_verified: plan.preflight.archive_checksum_verified,
      manifest_verified: plan.preflight.manifest_verified,
      resource_checksums_verified: plan.preflight.resource_checksums_verified,
      resource_counts_verified: plan.preflight.resource_counts_verified,
      storage_objects_verified: plan.preflight.storage_objects_verified,
      actor_snapshots_verified: plan.preflight.actor_snapshots_verified,
      schema_adapter_available: plan.preflight.schema_adapter_available,
      restored_storage_objects_verified: true,
      adapter_chain: plan.adapterChain,
    })
    finalizationAttempted = true
    const completeResponse = await args.supabase.rpc('complete_classroom_archive_restore', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_verification: verification,
    })
    if (completeResponse.error) {
      throw new ClassroomArchiveRestoreError(
        'classroom_archive_restore_finalize_failed',
        'Classroom archive restore could not be finalized',
        503,
        true,
      )
    }
    const parsedComplete = completeRestoreSchema.safeParse(completeResponse.data)
    if (!parsedComplete.success) {
      throw new ClassroomArchiveRestoreError(
        'classroom_archive_restore_finalize_contract_invalid',
        'Classroom archive restore finalization result is unknown',
        503,
        true,
      )
    }
    const completed = parsedComplete.data
    if (!completed.ok) {
      throw new ClassroomArchiveRestoreError(
        completed.error_code,
        completed.error,
        completed.status,
        completed.retryable,
      )
    }
    const result: ClassroomArchiveRestoreResult = {
      ok: true,
      status: completed.status,
      operation_id: completed.operation_id,
      archive_id: completed.archive_id,
      replayed: completed.replayed,
      resource_counts: completed.resource_counts,
      verification: completed.verification,
    }
    emitRestoreMetric(result, startedAt)
    return result
  } catch (cause) {
    const error = cause instanceof ClassroomArchiveRestoreError
      ? cause
      : new ClassroomArchiveRestoreError(
          'classroom_archive_restore_unexpected_failure',
          'Classroom archive restore encountered a transient unexpected failure',
          503,
          true,
        )
    const cleanupAuthorized = operationStarted
      ? await recordRestoreFailure({
        supabase: args.supabase,
        operationId: args.operationId,
        teacherId: args.teacherId,
        error,
      })
      : false
    const reportedError = operationStarted && !cleanupAuthorized
      ? new ClassroomArchiveRestoreError(
          'classroom_archive_restore_failure_recording_failed',
          'Classroom archive restore failure state could not be confirmed',
          503,
          true,
        )
      : error
    if (!reportedError.retryable && !finalizationAttempted && cleanupAuthorized) {
      const pathsByBucket = new Map<string, Set<string>>()
      for (const object of uploadedStorageObjects) {
        const paths = pathsByBucket.get(object.bucket) || new Set<string>()
        paths.add(object.path)
        pathsByBucket.set(object.bucket, paths)
      }
      for (const [bucket, paths] of pathsByBucket) {
        try {
          await args.supabase.storage.from(bucket).remove([...paths])
        } catch {
          // Durable cleanup owns any object that cannot be removed best-effort here.
        }
      }
    }
    const result = publicFailure({
      operationId: args.operationId,
      code: reportedError.code,
      message: reportedError.message,
      status: reportedError.status,
      retryable: reportedError.retryable,
    })
    emitRestoreMetric(result, startedAt)
    return result
  }
}
