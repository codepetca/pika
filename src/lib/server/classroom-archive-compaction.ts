import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CLASSROOM_ARCHIVE_V2_RESTORE_ORDER } from '@/lib/contracts/classroom-archive-resources'
import { classroomArchiveCompactionVerificationSchema } from '@/lib/contracts/classroom-lifecycle'
import {
  canonicalJsonStringify,
  decodeClassroomArchiveData,
  sha256Bytes,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import {
  buildClassroomArchiveV2RestorePlan,
  type ClassroomArchiveV2RestorePlan,
} from '@/lib/server/classroom-archive-restore'
import { getServiceRoleClient } from '@/lib/supabase'
import { parseDatabaseJson } from '@/lib/validations/database-json'

const CLASSROOM_ARCHIVE_BUCKET = 'classroom-archives' as const
const CLASSROOM_ARCHIVE_COMPACTION_MAX_BATCH_BYTES = 512 * 1024

export const CLASSROOM_ARCHIVE_COMPACTION_OBJECT_BATCH_SIZE = 200

const uuidSchema = z.string().uuid()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const resourceCountsSchema = z.record(z.string(), z.number().int().nonnegative())
const storageBucketCountsSchema = z.object({
  count: z.number().int().nonnegative(),
  bytes: z.number().int().nonnegative(),
}).strict()
const storageObjectCountsSchema = z.object({
  total_count: z.number().int().nonnegative(),
  total_bytes: z.number().int().nonnegative(),
  by_bucket: z.record(z.string(), storageBucketCountsSchema),
}).strict().superRefine((value, context) => {
  const allowedBuckets = new Set([
    'assignment-artifacts',
    'submission-images',
    'test-documents',
  ])
  for (const bucket of Object.keys(value.by_bucket)) {
    if (!allowedBuckets.has(bucket)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Compaction storage counts contain an unsupported bucket',
        path: ['by_bucket', bucket],
      })
    }
  }
})

const operationFailureSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(599),
  operation_id: uuidSchema,
  error_code: z.string().min(1),
  error: z.string().min(1),
  retryable: z.boolean(),
}).strict()

const completedVerificationSchema = classroomArchiveCompactionVerificationSchema.extend({
  source_revision_verified: z.literal(true),
  resource_ownership_verified: z.literal(true),
  relational_deletion_verified: z.literal(true),
  tombstone_verified: z.literal(true),
}).strict()

const completedOperationSchema = z.object({
  ok: z.literal(true),
  status: z.union([z.literal(200), z.literal(201)]),
  operation_id: uuidSchema,
  archive_id: uuidSchema,
  operation_status: z.literal('completed'),
  replayed: z.boolean(),
  resource_counts: resourceCountsSchema,
  storage_object_counts: storageObjectCountsSchema,
  verification: completedVerificationSchema,
}).strict()

const snapshotReadySchema = z.object({
  ok: z.literal(true),
  status: z.literal(202),
  operation_id: uuidSchema,
  archive_id: uuidSchema,
  operation_status: z.literal('snapshot_ready'),
  replayed: z.boolean(),
  snapshot_expires_at: z.string().datetime({ offset: true }),
  resource_counts: resourceCountsSchema,
  storage_object_counts: storageObjectCountsSchema,
  storage_bucket: z.literal(CLASSROOM_ARCHIVE_BUCKET),
  storage_path: z.string().min(1),
  artifact_sha256: sha256Schema,
  content_sha256: sha256Schema,
}).strict()

const stageSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.literal(202),
  operation_id: uuidSchema,
  operation_status: z.literal('snapshot_ready'),
  staged_object_count: z.number().int().nonnegative(),
  staged_object_bytes: z.number().int().nonnegative(),
}).strict()
const stageRowSuccessSchema = z.object({
  ok: z.literal(true),
  status: z.literal(202),
  operation_id: uuidSchema,
  table_name: z.string().min(1),
  staged_count: z.number().int().nonnegative(),
  expected_count: z.number().int().nonnegative(),
}).strict()

const beginOperationResultSchema = z.union([
  operationFailureSchema,
  snapshotReadySchema,
  completedOperationSchema,
])
const stageOperationResultSchema = z.union([operationFailureSchema, stageSuccessSchema])
const completeOperationResultSchema = z.union([operationFailureSchema, completedOperationSchema])
const booleanRpcSchema = z.boolean()

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type OperationFailure = z.infer<typeof operationFailureSchema>
type CompletedOperation = z.infer<typeof completedOperationSchema>
type SnapshotReady = z.infer<typeof snapshotReadySchema>
type CleanupObject = {
  storage_bucket: 'assignment-artifacts' | 'submission-images' | 'test-documents'
  storage_path: string
  sha256: string
  byte_size: number
}

export type ClassroomArchiveCompactionResult =
  | {
      ok: true
      status: 200 | 201
      operation_id: string
      archive_id: string
      replayed: boolean
      resource_counts: Record<string, number>
      storage_object_counts: z.infer<typeof storageObjectCountsSchema>
      cleanup_object_count: number
      cleanup_object_bytes: number
      verification: z.infer<typeof completedVerificationSchema>
    }
  | OperationFailure

class ClassroomArchiveCompactionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly recordFailure = true,
  ) {
    super(message)
    this.name = 'ClassroomArchiveCompactionError'
  }
}

export function resolveClassroomArchiveCompactionOperationId(
  value?: string | null,
): string {
  return value ? uuidSchema.parse(value.trim()) : randomUUID()
}

function parseAllowlist(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function isClassroomArchiveCompactionAllowed(args: {
  teacherId: string
  archiveId: string
}): boolean {
  if (process.env.CLASSROOM_ARCHIVE_COMPACTION_ENABLED?.trim().toLowerCase() !== 'true') {
    return false
  }
  const teacherId = uuidSchema.parse(args.teacherId)
  const archiveId = uuidSchema.parse(args.archiveId)
  return (
    parseAllowlist(process.env.CLASSROOM_ARCHIVE_COMPACTION_TEACHER_IDS).includes(teacherId) &&
    parseAllowlist(process.env.CLASSROOM_ARCHIVE_COMPACTION_ARCHIVE_IDS).includes(archiveId)
  )
}

function hashCompactionRequest(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value)).digest('hex')
}

function isArchiveStoragePath(args: {
  teacherId: string
  classroomId: string
  archiveId: string
  storagePath: string
}) {
  const prefix = `${args.teacherId}/${args.classroomId}/${args.archiveId}/classroom-v`
  return args.storagePath === `${prefix}1.tar.gz` || args.storagePath === `${prefix}2.tar.gz`
}

function isMissingCompactionRpc(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return error.code === '42883' || error.code === 'PGRST202' || (
    message.includes('begin_classroom_archive_compaction') ||
    message.includes('stage_classroom_archive_compaction_objects') ||
    message.includes('complete_classroom_archive_compaction') ||
    message.includes('fail_classroom_archive_compaction')
  )
}

function assertOperationIdentity(args: {
  result: z.infer<typeof beginOperationResultSchema>
  operationId: string
  archiveId: string
  teacherId: string
  classroomId: string
}) {
  if (args.result.operation_id !== args.operationId) {
    throw new ClassroomArchiveCompactionError(
      'compaction_rpc_contract_invalid',
      'Compaction operation response does not match the requested operation',
      500,
      false,
    )
  }
  if (!args.result.ok) return
  if (args.result.archive_id !== args.archiveId) {
    throw new ClassroomArchiveCompactionError(
      'compaction_rpc_contract_invalid',
      'Compaction operation response does not match the requested archive',
      500,
      false,
    )
  }
  if (
    args.result.operation_status === 'completed' &&
    (
      args.result.verification.operation_id !== args.operationId ||
      args.result.verification.archive_id !== args.archiveId
    )
  ) {
    throw new ClassroomArchiveCompactionError(
      'compaction_rpc_contract_invalid',
      'Compaction completion evidence does not match the requested operation',
      500,
      false,
    )
  }
  if (
    args.result.operation_status === 'snapshot_ready' &&
    !isArchiveStoragePath({
      ...args,
      storagePath: args.result.storage_path,
    })
  ) {
    throw new ClassroomArchiveCompactionError(
      'compaction_rpc_contract_invalid',
      'Compaction operation returned a noncanonical archive path',
      500,
      false,
    )
  }
}

function publicCompletedResult(result: CompletedOperation): ClassroomArchiveCompactionResult {
  return {
    ok: true,
    status: result.status,
    operation_id: result.operation_id,
    archive_id: result.archive_id,
    replayed: result.replayed,
    resource_counts: result.resource_counts,
    storage_object_counts: result.storage_object_counts,
    cleanup_object_count: result.storage_object_counts.total_count,
    cleanup_object_bytes: result.storage_object_counts.total_bytes,
    verification: result.verification,
  }
}

function unknownCompletionResult(
  operationId: string,
  message: string,
): OperationFailure {
  return {
    ok: false,
    status: 500,
    operation_id: operationId,
    error_code: 'compaction_completion_contract_unknown',
    error: message,
    retryable: false,
  }
}

async function readStorageBytes(blob: Blob | null): Promise<Uint8Array | null> {
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

function summarizeManifestStorage(
  manifest: Extract<ReturnType<typeof verifyClassroomArchiveBundle>, { ok: true }>['manifest'],
) {
  const byBucket: Record<string, { count: number; bytes: number }> = {}
  let totalBytes = 0
  for (const object of manifest.storage_objects) {
    byBucket[object.bucket] ||= { count: 0, bytes: 0 }
    byBucket[object.bucket].count += 1
    byBucket[object.bucket].bytes += object.byte_size
    totalBytes += object.byte_size
  }
  return storageObjectCountsSchema.parse({
    total_count: manifest.storage_objects.length,
    total_bytes: totalBytes,
    by_bucket: byBucket,
  })
}

function exactResourceCounts(
  manifest: Extract<ReturnType<typeof verifyClassroomArchiveBundle>, { ok: true }>['manifest'],
) {
  return Object.fromEntries(
    manifest.resources.map((resource) => [resource.table, resource.row_count]),
  )
}

function assertMatchingInventory(snapshot: SnapshotReady, args: {
  resources: Record<string, number>
  storage: z.infer<typeof storageObjectCountsSchema>
}) {
  if (canonicalJsonStringify(snapshot.resource_counts) !== canonicalJsonStringify(args.resources)) {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_resource_counts_mismatch',
      'Verified archive resource counts do not match the compaction snapshot',
      409,
      false,
    )
  }
  if (
    canonicalJsonStringify(snapshot.storage_object_counts) !==
    canonicalJsonStringify(args.storage)
  ) {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_storage_counts_mismatch',
      'Verified archive storage counts do not match the compaction snapshot',
      409,
      false,
    )
  }
}

async function downloadAndVerifyArchive(args: {
  supabase: SupabaseClient
  snapshot: SnapshotReady
  teacherId: string
  classroomId: string
  archiveId: string
  operationId: string
  supabaseUrl: string
}) {
  let response
  try {
    response = await args.supabase.storage
      .from(CLASSROOM_ARCHIVE_BUCKET)
      .download(args.snapshot.storage_path)
  } catch {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_download_failed',
      'Verified classroom archive bytes could not be downloaded',
      503,
      true,
    )
  }
  const bytes = await readStorageBytes(response.data)
  if (response.error || !bytes) {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_download_failed',
      'Verified classroom archive bytes could not be downloaded',
      503,
      true,
    )
  }
  if (sha256Bytes(bytes) !== args.snapshot.artifact_sha256) {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_checksum_mismatch',
      'Stored classroom archive checksum does not match immutable metadata',
      409,
      false,
    )
  }

  const verified = verifyClassroomArchiveBundle(bytes)
  if (!verified.ok) {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_verification_failed',
      'Stored classroom archive failed strict read-back verification',
      409,
      false,
    )
  }
  if (
    verified.manifest.archive_id !== args.archiveId ||
    verified.manifest.classroom_id !== args.classroomId ||
    verified.manifest.teacher_id !== args.teacherId
  ) {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_identity_mismatch',
      'Stored classroom archive identity does not match the compaction request',
      409,
      false,
    )
  }
  if (verified.manifest.content_sha256 !== args.snapshot.content_sha256) {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_content_checksum_mismatch',
      'Stored classroom archive content checksum does not match immutable metadata',
      409,
      false,
    )
  }

  const resources = exactResourceCounts(verified.manifest)
  const storage = summarizeManifestStorage(verified.manifest)
  assertMatchingInventory(args.snapshot, { resources, storage })

  const decoded = decodeClassroomArchiveData(verified)
  const actorIds = decoded.actors.map((actor) => actor.id)
  const currentActors: Array<{ id: string; email: string; role: 'student' | 'teacher' }> = []
  for (let offset = 0; offset < actorIds.length; offset += 200) {
    const response = await args.supabase
      .from('users')
      .select('id,email,role')
      .in('id', actorIds.slice(offset, offset + 200))
    if (response.error) {
      throw new ClassroomArchiveCompactionError(
        'archive_compaction_actor_reconciliation_failed',
        'Classroom archive actors could not be reconciled before compaction',
        503,
        true,
      )
    }
    currentActors.push(...(response.data || []) as typeof currentActors)
  }
  let restorePlan: ClassroomArchiveV2RestorePlan
  try {
    restorePlan = buildClassroomArchiveV2RestorePlan({
      verified,
      artifactChecksumVerified: true,
      operationId: args.operationId,
      currentActors,
      supabaseUrl: args.supabaseUrl,
    })
  } catch {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_restore_preflight_failed',
      'Classroom archive cannot be restored with the current schema and actor mapping',
      409,
      false,
    )
  }
  return {
    restorePlan,
    compactionResources: restorePlan.resources,
    cleanupObjects: verified.manifest.storage_objects.map((object): CleanupObject => ({
      storage_bucket: object.bucket,
      storage_path: object.source_path,
      sha256: object.sha256,
      byte_size: object.byte_size,
    })),
    storage,
  }
}

function rowBatches(rows: ClassroomArchiveV2RestorePlan['resources'][string]) {
  const batches: typeof rows[] = []
  let batch: typeof rows = []
  for (const row of rows) {
    const next = [...batch, row]
    if (batch.length > 0 && Buffer.byteLength(canonicalJsonStringify(next), 'utf8') > 900 * 1024) {
      batches.push(batch)
      batch = [row]
    } else {
      batch = next
    }
    if (batch.length === 250) {
      batches.push(batch)
      batch = []
    }
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

async function stageRestorePreflight(args: {
  supabase: SupabaseClient
  operationId: string
  teacherId: string
  resources: ClassroomArchiveV2RestorePlan['resources']
}) {
  for (const table of CLASSROOM_ARCHIVE_V2_RESTORE_ORDER) {
    for (const rows of rowBatches(args.resources[table] || [])) {
      const response = await args.supabase.rpc('stage_classroom_archive_restore_rows', {
        p_operation_id: args.operationId,
        p_teacher_id: args.teacherId,
        p_table_name: table,
        p_rows: parseDatabaseJson(rows),
      })
      const parsed = !response.error ? stageRowSuccessSchema.safeParse(response.data) : null
      if (!parsed || !parsed.success) {
        throw new ClassroomArchiveCompactionError(
          'archive_compaction_database_preflight_failed',
          'Classroom archive failed database restore preflight',
          409,
          false,
        )
      }
    }
  }
}

function cleanupObjectBatches(objects: CleanupObject[]): CleanupObject[][] {
  if (objects.length === 0) return [[]]
  const batches: CleanupObject[][] = []
  let batch: CleanupObject[] = []

  for (const object of objects) {
    const next = [...batch, object]
    const nextBytes = Buffer.byteLength(canonicalJsonStringify(next), 'utf8')
    if (
      batch.length > 0 &&
      (
        next.length > CLASSROOM_ARCHIVE_COMPACTION_OBJECT_BATCH_SIZE ||
        nextBytes > CLASSROOM_ARCHIVE_COMPACTION_MAX_BATCH_BYTES
      )
    ) {
      batches.push(batch)
      batch = [object]
    } else {
      batch = next
    }
    if (
      batch.length > CLASSROOM_ARCHIVE_COMPACTION_OBJECT_BATCH_SIZE ||
      Buffer.byteLength(canonicalJsonStringify(batch), 'utf8') >
        CLASSROOM_ARCHIVE_COMPACTION_MAX_BATCH_BYTES
    ) {
      throw new ClassroomArchiveCompactionError(
        'archive_compaction_cleanup_descriptor_too_large',
        'A source-object cleanup descriptor exceeds the staging contract',
        413,
        false,
      )
    }
  }
  if (batch.length > 0) batches.push(batch)
  return batches
}

async function stageCleanupObjects(args: {
  supabase: SupabaseClient
  operationId: string
  teacherId: string
  objects: CleanupObject[]
  expectedBytes: number
}) {
  let finalCount = -1
  let finalBytes = -1
  for (const batch of cleanupObjectBatches(args.objects)) {
    const response = await args.supabase.rpc('stage_classroom_archive_compaction_objects', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_objects: batch,
    })
    if (response.error) {
      throw new ClassroomArchiveCompactionError(
        isMissingCompactionRpc(response.error)
          ? 'classroom_archive_compaction_migration_required'
          : 'archive_compaction_cleanup_staging_failed',
        isMissingCompactionRpc(response.error)
          ? 'Classroom archive compaction requires migration 085'
          : 'Source-object cleanup inventory could not be staged',
        503,
        true,
      )
    }
    const parsed = stageOperationResultSchema.safeParse(response.data)
    if (!parsed.success || parsed.data.operation_id !== args.operationId) {
      throw new ClassroomArchiveCompactionError(
        'compaction_rpc_contract_invalid',
        'Compaction cleanup staging returned an invalid contract',
        500,
        false,
      )
    }
    if (!parsed.data.ok) {
      throw new ClassroomArchiveCompactionError(
        parsed.data.error_code,
        parsed.data.error,
        parsed.data.status,
        parsed.data.retryable,
      )
    }
    finalCount = parsed.data.staged_object_count
    finalBytes = parsed.data.staged_object_bytes
    if (finalCount > args.objects.length || finalBytes > args.expectedBytes) {
      throw new ClassroomArchiveCompactionError(
        'archive_compaction_cleanup_inventory_mismatch',
        'Staged source-object cleanup inventory exceeds the verified archive',
        409,
        false,
      )
    }
  }
  if (finalCount !== args.objects.length || finalBytes !== args.expectedBytes) {
    throw new ClassroomArchiveCompactionError(
      'archive_compaction_cleanup_inventory_mismatch',
      'Staged source-object cleanup inventory does not match the verified archive',
      409,
      false,
    )
  }
}

async function recordCompactionFailure(args: {
  supabase: SupabaseClient
  operationId: string
  teacherId: string
  error: ClassroomArchiveCompactionError
}) {
  if (!args.error.recordFailure) return false
  try {
    const response = await args.supabase.rpc('fail_classroom_archive_compaction', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_error_code: args.error.code,
      p_retryable: args.error.retryable,
    })
    if (response.error) return false
    const parsed = booleanRpcSchema.safeParse(response.data)
    return parsed.success && parsed.data
  } catch {
    return false
  }
}

function emitCompactionMetric(result: ClassroomArchiveCompactionResult, startedAt: number) {
  console.info('[classroom-archive-operation]', JSON.stringify({
    operation_id: result.operation_id,
    operation_type: 'compact',
    status: result.ok ? 'completed' : 'failed',
    replayed: result.ok ? result.replayed : false,
    duration_ms: Date.now() - startedAt,
    resource_counts: result.ok ? result.resource_counts : undefined,
    cleanup_object_count: result.ok ? result.cleanup_object_count : undefined,
    cleanup_object_bytes: result.ok ? result.cleanup_object_bytes : undefined,
    error_code: result.ok ? undefined : result.error_code,
    retryable: result.ok ? undefined : result.retryable,
  }))
}

export async function compactClassroomArchive(args: {
  supabase: SupabaseClient
  operationId: string
  teacherId: string
  classroomId: string
  archiveId: string
  supabaseUrl: string
}): Promise<ClassroomArchiveCompactionResult> {
  const startedAt = Date.now()
  const operationId = uuidSchema.parse(args.operationId)
  const teacherId = uuidSchema.parse(args.teacherId)
  const classroomId = uuidSchema.parse(args.classroomId)
  const archiveId = uuidSchema.parse(args.archiveId)

  if (!isClassroomArchiveCompactionAllowed({ teacherId, archiveId })) {
    const result: OperationFailure = {
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'classroom_archive_compaction_not_enabled',
      error: 'Classroom archive compaction is not enabled for this canary',
      retryable: true,
    }
    emitCompactionMetric(result, startedAt)
    return result
  }

  const requestSha256 = hashCompactionRequest({
    format: 'pika.classroom-archive',
    version: 2,
    transition: 'archived_hot:archived_cold',
    classroom_id: classroomId,
    archive_id: archiveId,
  })

  try {
    const beginResponse = await args.supabase.rpc('begin_classroom_archive_compaction', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_classroom_id: classroomId,
      p_archive_id: archiveId,
      p_request_sha256: requestSha256,
    })
    if (beginResponse.error) {
      const missingMigration = isMissingCompactionRpc(beginResponse.error)
      throw new ClassroomArchiveCompactionError(
        missingMigration
          ? 'classroom_archive_compaction_migration_required'
          : 'archive_compaction_begin_failed',
        missingMigration
          ? 'Classroom archive compaction requires migration 085'
          : 'Classroom archive compaction could not be started',
        503,
        true,
      )
    }

    const parsedBegin = beginOperationResultSchema.safeParse(beginResponse.data)
    if (!parsedBegin.success) {
      throw new ClassroomArchiveCompactionError(
        'compaction_rpc_contract_invalid',
        'Classroom archive compaction returned an invalid contract',
        500,
        false,
      )
    }
    assertOperationIdentity({
      result: parsedBegin.data,
      operationId,
      archiveId,
      teacherId,
      classroomId,
    })
    if (!parsedBegin.data.ok) {
      emitCompactionMetric(parsedBegin.data, startedAt)
      return parsedBegin.data
    }
    if (parsedBegin.data.operation_status === 'completed') {
      const result = publicCompletedResult(parsedBegin.data)
      emitCompactionMetric(result, startedAt)
      return result
    }

    const snapshot = parsedBegin.data
    const verified = await downloadAndVerifyArchive({
      supabase: args.supabase,
      snapshot,
      teacherId,
      classroomId,
      archiveId,
      operationId,
      supabaseUrl: args.supabaseUrl,
    })
    await stageRestorePreflight({
      supabase: args.supabase,
      operationId,
      teacherId,
      resources: verified.compactionResources,
    })
    await stageCleanupObjects({
      supabase: args.supabase,
      operationId,
      teacherId,
      objects: verified.cleanupObjects,
      expectedBytes: verified.storage.total_bytes,
    })

    const verification = classroomArchiveCompactionVerificationSchema.parse({
      operation_id: operationId,
      archive_id: archiveId,
      artifact_sha256: snapshot.artifact_sha256,
      content_sha256: snapshot.content_sha256,
      verified_at: new Date().toISOString(),
      read_back_verified: true,
      artifact_checksum_verified: true,
      manifest_verified: true,
      resource_checksums_verified: true,
      resource_counts_verified: true,
      storage_objects_verified: true,
      actor_snapshots_verified: true,
      schema_adapter_verified: true,
      actor_references_resolved: true,
      source_object_cleanup_staged: true,
    })
    const completeResponse = await args.supabase.rpc('complete_classroom_archive_compaction', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_actors: verified.restorePlan.actors
        .map((actor) => ({ actor_id: actor.id, role: actor.role }))
        .sort((left, right) => left.actor_id < right.actor_id ? -1 : left.actor_id > right.actor_id ? 1 : 0),
      p_verification: verification,
    })
    if (completeResponse.error) {
      const missingMigration = isMissingCompactionRpc(completeResponse.error)
      const terminalVerificationError = completeResponse.error.code === '22023'
      throw new ClassroomArchiveCompactionError(
        missingMigration
          ? 'classroom_archive_compaction_migration_required'
          : terminalVerificationError
            ? 'archive_compaction_verification_rejected'
            : 'archive_compaction_finalize_failed',
        missingMigration
          ? 'Classroom archive compaction requires migration 085'
          : terminalVerificationError
            ? 'Classroom archive compaction verification was rejected'
            : 'Classroom archive compaction could not be finalized',
        terminalVerificationError ? 409 : 503,
        !terminalVerificationError,
      )
    }

    const parsedComplete = completeOperationResultSchema.safeParse(completeResponse.data)
    if (!parsedComplete.success) {
      const result = unknownCompletionResult(
        operationId,
        'Compaction completion returned an unknown committed state',
      )
      emitCompactionMetric(result, startedAt)
      return result
    }
    if (parsedComplete.data.operation_id !== operationId) {
      const result = unknownCompletionResult(
        operationId,
        'Compaction completion identity returned an unknown committed state',
      )
      emitCompactionMetric(result, startedAt)
      return result
    }
    if (!parsedComplete.data.ok) {
      await recordCompactionFailure({
        supabase: args.supabase,
        operationId,
        teacherId,
        error: new ClassroomArchiveCompactionError(
          parsedComplete.data.error_code,
          parsedComplete.data.error,
          parsedComplete.data.status,
          parsedComplete.data.retryable,
        ),
      })
      emitCompactionMetric(parsedComplete.data, startedAt)
      return parsedComplete.data
    }
    if (
      parsedComplete.data.archive_id !== archiveId ||
      parsedComplete.data.verification.operation_id !== operationId ||
      parsedComplete.data.verification.archive_id !== archiveId ||
      parsedComplete.data.verification.artifact_sha256 !== snapshot.artifact_sha256 ||
      parsedComplete.data.verification.content_sha256 !== snapshot.content_sha256 ||
      canonicalJsonStringify(parsedComplete.data.resource_counts) !==
        canonicalJsonStringify(snapshot.resource_counts) ||
      canonicalJsonStringify(parsedComplete.data.storage_object_counts) !==
        canonicalJsonStringify(snapshot.storage_object_counts)
    ) {
      const result = unknownCompletionResult(
        operationId,
        'Compaction completion evidence returned an unknown committed state',
      )
      emitCompactionMetric(result, startedAt)
      return result
    }

    const result = publicCompletedResult(parsedComplete.data)
    emitCompactionMetric(result, startedAt)
    return result
  } catch (error) {
    const compactionError = error instanceof ClassroomArchiveCompactionError
      ? error
      : new ClassroomArchiveCompactionError(
          'archive_compaction_failed',
          'Classroom archive compaction failed',
          500,
          true,
        )
    await recordCompactionFailure({
      supabase: args.supabase,
      operationId,
      teacherId,
      error: compactionError,
    })
    const result: OperationFailure = {
      ok: false,
      status: compactionError.status,
      operation_id: operationId,
      error_code: compactionError.code,
      error: compactionError.message,
      retryable: compactionError.retryable,
    }
    emitCompactionMetric(result, startedAt)
    return result
  }
}
