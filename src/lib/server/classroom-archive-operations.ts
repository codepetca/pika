import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  classroomArchiveRetentionSchema,
} from '@/lib/contracts/classroom-artifacts'
import {
  CLASSROOM_RELATIONAL_RESOURCES,
  type ClassroomResourceTable,
} from '@/lib/contracts/classroom-data'
import {
  buildClassroomArchiveBundle,
  canonicalJsonStringify,
  discoverClassroomStorageReferences,
  sha256Bytes,
  verifyClassroomArchiveBundle,
  type ClassroomArchiveStorageObject,
} from '@/lib/server/classroom-archive-format'
import { getServiceRoleClient } from '@/lib/supabase'
import { parseDatabaseJson } from '@/lib/validations/database-json'

export const CLASSROOM_ARCHIVE_BUCKET = 'classroom-archives' as const
export const CLASSROOM_ARCHIVE_SOURCE_MIGRATION = '082_verified_classroom_archive_exports' as const
export const CLASSROOM_ARCHIVE_MAX_BYTES = 50 * 1024 * 1024

const uuidSchema = z.string().uuid()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const resourceCountsSchema = z.record(z.string(), z.number().int().nonnegative())
const archiveResourceRowsSchema = z.array(z.record(z.string(), z.json()))

const archiveVerificationSchema = z.object({
  read_back_verified: z.literal(true),
  artifact_checksum_verified: z.literal(true),
  manifest_verified: z.literal(true),
  resource_checksums_verified: z.literal(true),
  resource_counts_verified: z.literal(true),
  storage_objects_verified: z.literal(true),
  actor_snapshots_verified: z.literal(true),
  verified_at: z.string().datetime({ offset: true }),
}).strict()

const operationFailureSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(599),
  operation_id: uuidSchema,
  error_code: z.string().min(1),
  error: z.string().min(1),
  retryable: z.boolean(),
}).strict()

const snapshotReadySchema = z.object({
  ok: z.literal(true),
  status: z.literal(202),
  operation_id: uuidSchema,
  archive_id: uuidSchema,
  operation_status: z.literal('snapshot_ready'),
  replayed: z.boolean(),
  snapshot_created_at: z.string().datetime({ offset: true }),
  snapshot_expires_at: z.string().datetime({ offset: true }),
  source_revision: z.number().int().positive(),
  resource_counts: resourceCountsSchema,
}).strict()

const completedOperationSchema = z.object({
  ok: z.literal(true),
  status: z.union([z.literal(200), z.literal(201)]),
  operation_id: uuidSchema,
  archive_id: uuidSchema,
  operation_status: z.literal('completed'),
  replayed: z.boolean(),
  storage_bucket: z.literal(CLASSROOM_ARCHIVE_BUCKET),
  storage_path: z.string().min(1),
  artifact_sha256: sha256Schema,
  content_sha256: sha256Schema,
  compressed_byte_size: z.number().int().positive(),
  uncompressed_byte_size: z.number().int().positive(),
  resource_counts: resourceCountsSchema,
  storage_object_counts: z.record(z.string(), z.unknown()).optional(),
  verification: archiveVerificationSchema,
  snapshot_created_at: z.string().datetime({ offset: true }).optional(),
  snapshot_expires_at: z.string().datetime({ offset: true }).optional(),
  source_revision: z.number().int().positive().optional(),
}).strict()

const beginOperationResultSchema = z.union([
  operationFailureSchema,
  snapshotReadySchema,
  completedOperationSchema,
])

const completeOperationResultSchema = z.union([
  operationFailureSchema,
  completedOperationSchema,
])

export type ClassroomArchiveExportResult =
  | {
      ok: true
      status: 200 | 201
      operation_id: string
      archive_id: string
      replayed: boolean
      artifact_sha256: string
      content_sha256: string
      compressed_byte_size: number
      uncompressed_byte_size: number
      resource_counts: Record<string, number>
      storage_object_counts: Record<string, unknown>
      verification: z.infer<typeof archiveVerificationSchema>
    }
  | z.infer<typeof operationFailureSchema>

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type ArchiveRetention = z.infer<typeof classroomArchiveRetentionSchema>

type ArchiveResourceSelect = {
  in: (column: string, values: readonly string[]) => {
    order: (
      column: string,
      options: { ascending: boolean },
    ) => PromiseLike<{ data: unknown; error: unknown }>
  }
}

function selectArchiveResourceRows(
  supabase: SupabaseClient,
  table: ClassroomResourceTable,
): ArchiveResourceSelect {
  // Supabase cannot correlate a runtime table/primary-key pair; the result is parsed below.
  return supabase.from(table).select('*') as unknown as ArchiveResourceSelect
}

class ClassroomArchiveExportError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ClassroomArchiveExportError'
  }
}

function assertExactResourceCounts(counts: Record<string, number>) {
  const expectedTables = CLASSROOM_RELATIONAL_RESOURCES.map((resource) => resource.table)
  const actualTables = Object.keys(counts).sort()
  if (
    actualTables.length !== expectedTables.length ||
    expectedTables.some((table) => !Object.hasOwn(counts, table))
  ) {
    throw new ClassroomArchiveExportError(
      'archive_snapshot_contract_invalid',
      'Archive snapshot does not match the classroom resource contract',
      500,
      false,
    )
  }
}

export function resolveClassroomArchiveOperationId(value: string | null | undefined): string {
  return value ? uuidSchema.parse(value.trim()) : randomUUID()
}

export function resolveClassroomArchiveSourceCommit(): string {
  const commit =
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
    process.env.PIKA_APP_COMMIT
  if (!commit || !/^[a-f0-9]{7,40}$/.test(commit)) {
    throw new ClassroomArchiveExportError(
      'archive_source_version_unavailable',
      'Archive export requires the deployed application commit',
      503,
      true,
    )
  }
  return commit
}

export function isClassroomArchiveExportAllowed(teacherId: string): boolean {
  if (process.env.CLASSROOM_ARCHIVE_EXPORT_ENABLED?.trim().toLowerCase() !== 'true') {
    return false
  }
  const parsedTeacherId = uuidSchema.parse(teacherId)
  const allowedTeacherIds = (process.env.CLASSROOM_ARCHIVE_EXPORT_TEACHER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  return allowedTeacherIds.some((value) => value === parsedTeacherId)
}

export function hashClassroomArchiveRequest(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value)).digest('hex')
}

export function classroomArchiveStoragePath(args: {
  teacherId: string
  classroomId: string
  archiveId: string
}): string {
  return `${uuidSchema.parse(args.teacherId)}/${uuidSchema.parse(args.classroomId)}/${uuidSchema.parse(args.archiveId)}/classroom-v1.tar.gz`
}

function isMissingArchiveRpc(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return (
    error.code === '42883' ||
    error.code === 'PGRST202' ||
    message.includes('begin_classroom_archive_export') ||
    message.includes('complete_classroom_archive_export')
  )
}

async function loadSnapshotIds(
  supabase: SupabaseClient,
  operationId: string,
  table: string,
): Promise<string[]> {
  const pageSize = 1000
  const ids: string[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('classroom_archive_snapshot_resources')
      .select('row_id')
      .eq('operation_id', operationId)
      .eq('table_name', table)
      .order('row_id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) {
      throw new ClassroomArchiveExportError(
        'archive_snapshot_read_failed',
        'Failed to read archive snapshot membership',
        500,
        true,
      )
    }
    const page = (data || []).map((row) => String(row.row_id))
    ids.push(...page)
    if (page.length < pageSize) break
  }
  return ids
}

async function loadResourceRows<Table extends ClassroomResourceTable>(
  supabase: SupabaseClient,
  operationId: string,
  table: Table,
  primaryKey: string,
  expectedCount: number,
): Promise<unknown[]> {
  const ids = await loadSnapshotIds(supabase, operationId, table)
  if (ids.length !== expectedCount) {
    throw new ClassroomArchiveExportError(
      'archive_snapshot_count_mismatch',
      'Archive snapshot membership count changed',
      409,
      false,
    )
  }

  const rows: Record<string, unknown>[] = []
  const chunkSize = 200
  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize)
    const { data, error } = await selectArchiveResourceRows(supabase, table)
      .in(primaryKey, chunk)
      .order(primaryKey, { ascending: true })
    if (error) {
      throw new ClassroomArchiveExportError(
        'archive_resource_read_failed',
        `Failed to read archive resource ${table}`,
        500,
        true,
      )
    }
    const parsedRows = archiveResourceRowsSchema.safeParse(data || [])
    if (!parsedRows.success) {
      throw new ClassroomArchiveExportError(
        'archive_resource_contract_invalid',
        `Archive resource ${table} returned non-JSON rows`,
        500,
        false,
      )
    }
    rows.push(...parsedRows.data)
  }

  if (rows.length !== expectedCount) {
    throw new ClassroomArchiveExportError(
      'archive_source_row_missing',
      'A classroom row disappeared during archive export',
      409,
      false,
    )
  }
  const returnedKeys = new Set(rows.map((row) => String(row[primaryKey])))
  if (returnedKeys.size !== ids.length || ids.some((id) => !returnedKeys.has(id))) {
    throw new ClassroomArchiveExportError(
      'archive_source_membership_mismatch',
      'Classroom archive rows do not match the captured membership',
      409,
      false,
    )
  }
  return rows
}

async function loadClassroomResources(
  supabase: SupabaseClient,
  operationId: string,
  resourceCounts: Record<string, number>,
): Promise<Record<string, unknown[]>> {
  const resources: Record<string, unknown[]> = {}
  for (const resource of CLASSROOM_RELATIONAL_RESOURCES) {
    if (resource.primary_key.length !== 1) {
      throw new ClassroomArchiveExportError(
        'archive_composite_key_adapter_required',
        `Archive resource ${resource.table} requires a composite-key adapter`,
        503,
        false,
      )
    }
    resources[resource.table] = await loadResourceRows(
      supabase,
      operationId,
      resource.table,
      resource.primary_key[0],
      resourceCounts[resource.table],
    )
  }
  return resources
}

async function loadActorSnapshots(
  supabase: SupabaseClient,
  operationId: string,
): Promise<unknown[]> {
  const pageSize = 1000
  const actors: unknown[] = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('classroom_archive_snapshot_actors')
      .select('snapshot')
      .eq('operation_id', operationId)
      .order('actor_id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) {
      throw new ClassroomArchiveExportError(
        'archive_actor_snapshot_read_failed',
        'Failed to read archive actor snapshots',
        500,
        true,
      )
    }
    const page = (data || []).map((row) => row.snapshot)
    actors.push(...page)
    if (page.length < pageSize) break
  }
  return actors
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function run() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await worker(values[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run))
  return results
}

async function downloadStorageObjects(
  supabase: SupabaseClient,
  resources: Record<string, unknown[]>,
  supabaseUrl: string,
): Promise<ClassroomArchiveStorageObject[]> {
  const references = discoverClassroomStorageReferences(resources, supabaseUrl)
  return mapWithConcurrency(references, 4, async (reference) => {
    const { data, error } = await supabase.storage.from(reference.bucket).download(reference.path)
    if (error || !data) {
      throw new ClassroomArchiveExportError(
        'archive_source_object_missing',
        'A referenced classroom storage object could not be read',
        409,
        false,
      )
    }
    return {
      bucket: reference.bucket,
      sourcePath: reference.path,
      contentType: data.type || null,
      bytes: new Uint8Array(await data.arrayBuffer()),
    }
  })
}

function summarizeStorageObjects(objects: ClassroomArchiveStorageObject[]): Record<string, unknown> {
  const byBucket: Record<string, { count: number; bytes: number }> = {}
  let totalBytes = 0
  for (const object of objects) {
    byBucket[object.bucket] ||= { count: 0, bytes: 0 }
    byBucket[object.bucket].count += 1
    byBucket[object.bucket].bytes += object.bytes.byteLength
    totalBytes += object.bytes.byteLength
  }
  return {
    total_count: objects.length,
    total_bytes: totalBytes,
    by_bucket: byBucket,
  }
}

async function readStorageBytes(blob: Blob | null): Promise<Uint8Array | null> {
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

async function uploadAndReadBackArchive(args: {
  supabase: SupabaseClient
  storagePath: string
  archive: Uint8Array
  artifactSha256: string
}): Promise<{ bytes: Uint8Array; uploadedByThisAttempt: boolean }> {
  const bucket = args.supabase.storage.from(CLASSROOM_ARCHIVE_BUCKET)
  const existing = await bucket.download(args.storagePath)
  let uploadedByThisAttempt = false
  let bytes = await readStorageBytes(existing.data)

  if (!bytes) {
    const upload = await bucket.upload(args.storagePath, args.archive, {
      contentType: 'application/gzip',
      cacheControl: '3600',
      upsert: false,
    })
    if (upload.error) {
      const retryDownload = await bucket.download(args.storagePath)
      bytes = await readStorageBytes(retryDownload.data)
      if (!bytes) {
        throw new ClassroomArchiveExportError(
          'archive_storage_upload_failed',
          'Failed to upload classroom archive',
          503,
          true,
        )
      }
    } else {
      uploadedByThisAttempt = true
      const readBack = await bucket.download(args.storagePath)
      bytes = await readStorageBytes(readBack.data)
      if (!bytes) {
        await bucket.remove([args.storagePath])
        throw new ClassroomArchiveExportError(
          'archive_storage_readback_failed',
          'Classroom archive could not be read back after upload',
          503,
          true,
        )
      }
    }
  }

  if (sha256Bytes(bytes) !== args.artifactSha256) {
    if (uploadedByThisAttempt) await bucket.remove([args.storagePath])
    throw new ClassroomArchiveExportError(
      'archive_storage_checksum_mismatch',
      'Stored classroom archive checksum does not match',
      409,
      false,
    )
  }
  return { bytes, uploadedByThisAttempt }
}

function publicCompletedResult(
  result: z.infer<typeof completedOperationSchema>,
): ClassroomArchiveExportResult {
  return {
    ok: true,
    status: result.status,
    operation_id: result.operation_id,
    archive_id: result.archive_id,
    replayed: result.replayed,
    artifact_sha256: result.artifact_sha256,
    content_sha256: result.content_sha256,
    compressed_byte_size: result.compressed_byte_size,
    uncompressed_byte_size: result.uncompressed_byte_size,
    resource_counts: result.resource_counts,
    storage_object_counts: result.storage_object_counts || {},
    verification: result.verification,
  }
}

async function recordArchiveFailure(
  supabase: SupabaseClient,
  operationId: string,
  teacherId: string,
  error: ClassroomArchiveExportError,
) {
  await supabase.rpc('fail_classroom_archive_export', {
    p_operation_id: operationId,
    p_teacher_id: teacherId,
    p_error_code: error.code,
    p_retryable: error.retryable,
  })
}

function emitArchiveMetric(result: ClassroomArchiveExportResult, startedAt: number) {
  console.info('[classroom-archive-operation]', JSON.stringify({
    operation_id: result.operation_id,
    operation_type: 'export',
    status: result.ok ? 'completed' : 'failed',
    replayed: result.ok ? result.replayed : false,
    duration_ms: Date.now() - startedAt,
    compressed_byte_size: result.ok ? result.compressed_byte_size : undefined,
    uncompressed_byte_size: result.ok ? result.uncompressed_byte_size : undefined,
    resource_counts: result.ok ? result.resource_counts : undefined,
    error_code: result.ok ? undefined : result.error_code,
    retryable: result.ok ? undefined : result.retryable,
  }))
}

export async function exportClassroomArchive(args: {
  supabase: SupabaseClient
  operationId: string
  teacherId: string
  classroomId: string
  retention: ArchiveRetention
  sourceAppCommit: string
  supabaseUrl: string
}): Promise<ClassroomArchiveExportResult> {
  const startedAt = Date.now()
  const retention = classroomArchiveRetentionSchema.parse(args.retention)
  const requestSha256 = hashClassroomArchiveRequest({
    format: 'pika.classroom-archive',
    version: 1,
    classroom_id: args.classroomId,
    retention,
  })

  try {
    const beginResponse = await args.supabase.rpc('begin_classroom_archive_export', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_classroom_id: args.classroomId,
      p_request_sha256: requestSha256,
      p_source_schema_migration: CLASSROOM_ARCHIVE_SOURCE_MIGRATION,
      p_source_app_commit: args.sourceAppCommit,
      p_retention: retention,
    })
    if (beginResponse.error) {
      throw new ClassroomArchiveExportError(
        isMissingArchiveRpc(beginResponse.error)
          ? 'classroom_archive_migration_required'
          : 'archive_snapshot_begin_failed',
        isMissingArchiveRpc(beginResponse.error)
          ? 'Classroom archive export requires migration 082'
          : 'Failed to start classroom archive snapshot',
        503,
        true,
      )
    }

    const parsedBegin = beginOperationResultSchema.safeParse(beginResponse.data)
    if (!parsedBegin.success) {
      throw new ClassroomArchiveExportError(
        'archive_rpc_contract_invalid',
        'Classroom archive snapshot returned an invalid contract',
        500,
        false,
      )
    }
    if (!parsedBegin.data.ok) {
      emitArchiveMetric(parsedBegin.data, startedAt)
      return parsedBegin.data
    }
    if (parsedBegin.data.operation_status === 'completed') {
      const result = publicCompletedResult(parsedBegin.data)
      emitArchiveMetric(result, startedAt)
      return result
    }

    const snapshot = parsedBegin.data
    assertExactResourceCounts(snapshot.resource_counts)
    const resources = await loadClassroomResources(
      args.supabase,
      args.operationId,
      snapshot.resource_counts,
    )
    const actors = await loadActorSnapshots(args.supabase, args.operationId)
    const storageObjects = await downloadStorageObjects(
      args.supabase,
      resources,
      args.supabaseUrl,
    )
    const storageObjectCounts = summarizeStorageObjects(storageObjects)
    const bundle = buildClassroomArchiveBundle({
      archiveId: snapshot.archive_id,
      classroomId: args.classroomId,
      teacherId: args.teacherId,
      createdAt: snapshot.snapshot_created_at,
      source: {
        schemaMigration: CLASSROOM_ARCHIVE_SOURCE_MIGRATION,
        appCommit: args.sourceAppCommit,
      },
      retention,
      resources,
      actors,
      storageObjects,
    })
    if (bundle.archive.byteLength > CLASSROOM_ARCHIVE_MAX_BYTES) {
      throw new ClassroomArchiveExportError(
        'archive_exceeds_free_plan_file_limit',
        'Classroom archive exceeds the 50 MB Supabase Free upload limit',
        413,
        false,
      )
    }

    const storagePath = classroomArchiveStoragePath({
      teacherId: args.teacherId,
      classroomId: args.classroomId,
      archiveId: snapshot.archive_id,
    })
    const uploadIntentResponse = await args.supabase.rpc(
      'stage_classroom_archive_object_upload',
      {
        p_operation_id: args.operationId,
        p_teacher_id: args.teacherId,
        p_storage_bucket: CLASSROOM_ARCHIVE_BUCKET,
        p_storage_path: storagePath,
        p_expected_sha256: bundle.artifactSha256,
        p_expected_byte_size: bundle.archive.byteLength,
      },
    )
    const uploadIntent = !uploadIntentResponse.error
      ? z.boolean().safeParse(uploadIntentResponse.data)
      : null
    if (!uploadIntent || !uploadIntent.success || !uploadIntent.data) {
      throw new ClassroomArchiveExportError(
        'archive_upload_intent_failed',
        'Classroom archive upload could not be staged',
        503,
        true,
      )
    }
    const stored = await uploadAndReadBackArchive({
      supabase: args.supabase,
      storagePath,
      archive: bundle.archive,
      artifactSha256: bundle.artifactSha256,
    })
    const verification = verifyClassroomArchiveBundle(stored.bytes)
    if (!verification.ok) {
      if (stored.uploadedByThisAttempt) {
        await args.supabase.storage.from(CLASSROOM_ARCHIVE_BUCKET).remove([storagePath])
      }
      throw new ClassroomArchiveExportError(
        'archive_readback_verification_failed',
        'Stored classroom archive failed strict read-back verification',
        409,
        false,
      )
    }
    if (
      verification.manifest.archive_id !== snapshot.archive_id ||
      verification.manifest.classroom_id !== args.classroomId ||
      verification.manifest.teacher_id !== args.teacherId
    ) {
      if (stored.uploadedByThisAttempt) {
        await args.supabase.storage.from(CLASSROOM_ARCHIVE_BUCKET).remove([storagePath])
      }
      throw new ClassroomArchiveExportError(
        'archive_readback_identity_mismatch',
        'Stored classroom archive identity does not match the operation',
        409,
        false,
      )
    }

    const verificationEvidence = archiveVerificationSchema.parse({
      read_back_verified: true,
      artifact_checksum_verified: true,
      manifest_verified: true,
      resource_checksums_verified: true,
      resource_counts_verified: true,
      storage_objects_verified: true,
      actor_snapshots_verified: true,
      verified_at: new Date().toISOString(),
    })
    const completeResponse = await args.supabase.rpc('complete_classroom_archive_export', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_storage_bucket: CLASSROOM_ARCHIVE_BUCKET,
      p_storage_path: storagePath,
      p_artifact_sha256: bundle.artifactSha256,
      p_content_sha256: bundle.manifest.content_sha256,
      p_compressed_byte_size: bundle.archive.byteLength,
      p_uncompressed_byte_size: bundle.uncompressedByteSize,
      p_resource_counts: snapshot.resource_counts,
      p_storage_object_counts: parseDatabaseJson(storageObjectCounts),
      p_verification: verificationEvidence,
    })
    if (completeResponse.error) {
      throw new ClassroomArchiveExportError(
        isMissingArchiveRpc(completeResponse.error)
          ? 'classroom_archive_migration_required'
          : 'archive_finalize_failed',
        'Classroom archive could not be finalized',
        503,
        true,
      )
    }
    const parsedComplete = completeOperationResultSchema.safeParse(completeResponse.data)
    if (!parsedComplete.success) {
      throw new ClassroomArchiveExportError(
        'archive_rpc_contract_invalid',
        'Classroom archive finalization returned an invalid contract',
        500,
        false,
      )
    }
    if (!parsedComplete.data.ok) {
      if (!parsedComplete.data.retryable && stored.uploadedByThisAttempt) {
        await args.supabase.storage.from(CLASSROOM_ARCHIVE_BUCKET).remove([storagePath])
      }
      emitArchiveMetric(parsedComplete.data, startedAt)
      return parsedComplete.data
    }

    const result = publicCompletedResult(parsedComplete.data)
    emitArchiveMetric(result, startedAt)
    return result
  } catch (error) {
    const archiveError = error instanceof ClassroomArchiveExportError
      ? error
      : new ClassroomArchiveExportError(
          'archive_export_failed',
          'Classroom archive export failed',
          500,
          true,
        )
    await recordArchiveFailure(args.supabase, args.operationId, args.teacherId, archiveError)
    const result: ClassroomArchiveExportResult = {
      ok: false,
      status: archiveError.status,
      operation_id: args.operationId,
      error_code: archiveError.code,
      error: archiveError.message,
      retryable: archiveError.retryable,
    }
    emitArchiveMetric(result, startedAt)
    return result
  }
}
