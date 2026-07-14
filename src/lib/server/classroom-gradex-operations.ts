import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  GRADEX_EXTRACT_FORMAT,
  GRADEX_EXTRACT_VERSION,
} from '@/lib/contracts/classroom-artifacts'
import { GRADEX_RESOURCE_TABLES } from '@/lib/contracts/classroom-data'
import {
  canonicalJsonStringify,
  sha256Bytes,
  verifyClassroomArchiveBundle,
} from '@/lib/server/classroom-archive-format'
import {
  buildGradexExtractFromClassroomArchive,
  verifyGradexExtractBundle,
} from '@/lib/server/classroom-gradex-extract'
import { getServiceRoleClient } from '@/lib/supabase'

export const CLASSROOM_GRADEX_EXTRACT_BUCKET = 'gradex-analytics-extracts' as const
export const CLASSROOM_GRADEX_EXTRACT_MAX_BYTES = 50 * 1024 * 1024

const uuidSchema = z.string().uuid()
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const timestampSchema = z.string().datetime({ offset: true })
const resourceCountsSchema = z.record(z.string(), z.number().int().nonnegative())

const gradexVerificationSchema = z.object({
  source_archive_checksum_verified: z.literal(true),
  source_archive_manifest_verified: z.literal(true),
  resource_checksums_verified: z.literal(true),
  resource_counts_verified: z.literal(true),
  structured_privacy_verified: z.literal(true),
  pseudonym_relationships_verified: z.literal(true),
  storage_objects_excluded: z.literal(true),
  read_back_verified: z.literal(true),
  artifact_checksum_verified: z.literal(true),
  direct_identifier_findings: z.literal(0),
  verified_at: timestampSchema,
}).strict()

const operationFailureSchema = z.object({
  ok: z.literal(false),
  status: z.number().int().min(400).max(599),
  operation_id: uuidSchema,
  error_code: z.string().regex(/^[a-z0-9_]{3,80}$/),
  error: z.string().min(1),
  retryable: z.boolean(),
}).strict()

const snapshotReadySchema = z.object({
  ok: z.literal(true),
  status: z.literal(202),
  operation_id: uuidSchema,
  extract_id: uuidSchema,
  operation_status: z.literal('snapshot_ready'),
  replayed: z.boolean(),
  source_archive_id: uuidSchema,
  source_archive_sha256: sha256Schema,
  storage_bucket: z.literal(CLASSROOM_GRADEX_EXTRACT_BUCKET),
  storage_path: z.string().min(1),
  generated_at: timestampSchema,
  snapshot_expires_at: timestampSchema,
  delete_after: timestampSchema,
}).strict()

const completedOperationSchema = z.object({
  ok: z.literal(true),
  status: z.union([z.literal(200), z.literal(201)]),
  operation_id: uuidSchema,
  extract_id: uuidSchema,
  operation_status: z.literal('completed'),
  replayed: z.boolean(),
  source_archive_id: uuidSchema,
  storage_bucket: z.literal(CLASSROOM_GRADEX_EXTRACT_BUCKET),
  storage_path: z.string().min(1),
  artifact_sha256: sha256Schema,
  content_sha256: sha256Schema,
  compressed_byte_size: z.number().int().positive(),
  uncompressed_byte_size: z.number().int().positive(),
  resource_counts: resourceCountsSchema,
  verification: gradexVerificationSchema,
  generated_at: timestampSchema,
  delete_after: timestampSchema,
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

const sourceArchiveMetadataSchema = z.object({
  id: uuidSchema,
  classroom_id: uuidSchema,
  teacher_id: uuidSchema,
  format: z.literal('pika.classroom-archive'),
  format_version: z.literal(1),
  storage_bucket: z.literal('classroom-archives'),
  storage_path: z.string().min(1),
  artifact_sha256: sha256Schema,
}).strict()

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type GradexVerification = z.infer<typeof gradexVerificationSchema>

export type ClassroomGradexExtractResult =
  | {
      ok: true
      status: 200 | 201
      operation_id: string
      extract_id: string
      source_archive_id: string
      replayed: boolean
      artifact_sha256: string
      content_sha256: string
      compressed_byte_size: number
      uncompressed_byte_size: number
      resource_counts: Record<string, number>
      verification: GradexVerification
      generated_at: string
      delete_after: string
    }
  | z.infer<typeof operationFailureSchema>

class ClassroomGradexExtractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'ClassroomGradexExtractError'
  }
}

export function resolveClassroomGradexOperationId(value: string | null | undefined): string {
  return value ? uuidSchema.parse(value.trim()) : randomUUID()
}

export function isClassroomGradexExtractAllowed(teacherId: string): boolean {
  if (process.env.CLASSROOM_GRADEX_EXTRACT_ENABLED?.trim().toLowerCase() !== 'true') {
    return false
  }
  const parsedTeacherId = uuidSchema.parse(teacherId)
  return (process.env.CLASSROOM_GRADEX_EXTRACT_TEACHER_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => value === parsedTeacherId)
}

export function isClassroomGradexTriggerAllowed(archiveId: string): boolean {
  if (process.env.CLASSROOM_GRADEX_TRIGGER_ENABLED?.trim().toLowerCase() !== 'true') {
    return false
  }
  const parsedArchiveId = uuidSchema.parse(archiveId)
  return (process.env.CLASSROOM_GRADEX_TRIGGER_ARCHIVE_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .some((value) => value === parsedArchiveId)
}

export function resolveClassroomGradexHmacSecret(): string {
  const secret = process.env.CLASSROOM_GRADEX_EXTRACT_HMAC_SECRET?.trim()
  if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('CLASSROOM_GRADEX_EXTRACT_HMAC_SECRET must contain at least 32 bytes')
  }
  return secret
}

export function hashClassroomGradexRequest(value: unknown): string {
  return createHash('sha256').update(canonicalJsonStringify(value)).digest('hex')
}

function isMissingGradexRpc(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return error.code === '42883' || error.code === 'PGRST202' || (
    message.includes('begin_classroom_gradex_extract') ||
    message.includes('complete_classroom_gradex_extract')
  )
}

function assertExactResourceCounts(counts: Record<string, number>) {
  const actual = Object.keys(counts)
  if (
    actual.length !== GRADEX_RESOURCE_TABLES.length ||
    GRADEX_RESOURCE_TABLES.some((table) => !Object.hasOwn(counts, table))
  ) {
    throw new ClassroomGradexExtractError(
      'gradex_resource_contract_invalid',
      'Gradex extract resource counts do not match the allowlist',
      500,
      false,
    )
  }
}

function classroomGradexStoragePath(args: {
  operationId: string
  teacherId: string
  classroomId: string
}) {
  return `${args.teacherId}/${args.classroomId}/${args.operationId}/gradex-v1.tar.gz`
}

function assertOperationIdentity(args: {
  result: z.infer<typeof beginOperationResultSchema> | z.infer<typeof completeOperationResultSchema>
  operationId: string
  sourceArchiveId: string
  teacherId: string
  classroomId: string
  deleteAfter: string
}) {
  if (args.result.operation_id !== args.operationId) {
    throw new ClassroomGradexExtractError(
      'gradex_rpc_contract_invalid',
      'Gradex operation response does not match the requested operation',
      500,
      false,
    )
  }
  if (!args.result.ok) return
  if (
    args.result.extract_id !== args.operationId ||
    args.result.source_archive_id !== args.sourceArchiveId ||
    args.result.storage_path !== classroomGradexStoragePath(args) ||
    Date.parse(args.result.delete_after) !== Date.parse(args.deleteAfter)
  ) {
    throw new ClassroomGradexExtractError(
      'gradex_rpc_contract_invalid',
      'Gradex operation response identity does not match the request',
      500,
      false,
    )
  }
}

async function readStorageBytes(blob: Blob | null): Promise<Uint8Array | null> {
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null
}

async function removeGradexObject(args: {
  supabase: SupabaseClient
  operationId: string
  storagePath: string
}) {
  let removed = false
  try {
    const response = await args.supabase.storage
      .from(CLASSROOM_GRADEX_EXTRACT_BUCKET)
      .remove([args.storagePath])
    removed = !response.error
  } catch {
    removed = false
  }
  console.warn('[classroom-gradex-cleanup]', JSON.stringify({
    operation_id: args.operationId,
    cleanup_type: 'unfinalized_object',
    status: removed ? 'deleted' : 'failed',
    error_code: removed ? undefined : 'gradex_orphan_cleanup_failed',
  }))
  return removed
}

async function loadSourceArchiveMetadata(args: {
  supabase: SupabaseClient
  archiveId: string
  classroomId: string
  teacherId: string
}) {
  const response = await args.supabase
    .from('classroom_archives')
    .select(
      'id,classroom_id,teacher_id,format,format_version,storage_bucket,storage_path,artifact_sha256',
    )
    .eq('id', args.archiveId)
    .eq('classroom_id', args.classroomId)
    .eq('teacher_id', args.teacherId)
    .single()
  if (response.error) {
    throw new ClassroomGradexExtractError(
      'gradex_source_archive_metadata_unavailable',
      'Verified source archive metadata could not be loaded',
      503,
      true,
    )
  }
  const parsed = sourceArchiveMetadataSchema.safeParse(response.data)
  if (!parsed.success) {
    throw new ClassroomGradexExtractError(
      'gradex_source_archive_contract_invalid',
      'Verified source archive metadata returned an invalid contract',
      500,
      false,
    )
  }
  return parsed.data
}

async function downloadSourceArchive(args: {
  supabase: SupabaseClient
  bucket: string
  path: string
}) {
  const response = await args.supabase.storage.from(args.bucket).download(args.path)
  const bytes = await readStorageBytes(response.data)
  if (response.error || !bytes) {
    throw new ClassroomGradexExtractError(
      'gradex_source_archive_download_failed',
      'Verified source archive bytes could not be downloaded',
      503,
      true,
    )
  }
  return bytes
}

async function uploadAndReadBackExtract(args: {
  supabase: SupabaseClient
  operationId: string
  storagePath: string
  extract: Uint8Array
  artifactSha256: string
}): Promise<{ bytes: Uint8Array; uploadedByThisAttempt: boolean }> {
  const bucket = args.supabase.storage.from(CLASSROOM_GRADEX_EXTRACT_BUCKET)
  const existing = await bucket.download(args.storagePath)
  let bytes = await readStorageBytes(existing.data)
  let uploadedByThisAttempt = false

  if (!bytes) {
    const upload = await bucket.upload(args.storagePath, args.extract, {
      contentType: 'application/gzip',
      cacheControl: '3600',
      upsert: false,
    })
    if (upload.error) {
      const concurrent = await bucket.download(args.storagePath)
      bytes = await readStorageBytes(concurrent.data)
      if (!bytes) {
        throw new ClassroomGradexExtractError(
          'gradex_storage_upload_failed',
          'Gradex extract could not be uploaded to private storage',
          503,
          true,
        )
      }
    } else {
      uploadedByThisAttempt = true
      const readBack = await bucket.download(args.storagePath)
      bytes = await readStorageBytes(readBack.data)
      if (!bytes) {
        await removeGradexObject(args)
        throw new ClassroomGradexExtractError(
          'gradex_storage_readback_failed',
          'Gradex extract could not be read back after upload',
          503,
          true,
        )
      }
    }
  }

  if (sha256Bytes(bytes) !== args.artifactSha256) {
    if (uploadedByThisAttempt) await removeGradexObject(args)
    throw new ClassroomGradexExtractError(
      'gradex_storage_checksum_mismatch',
      'Stored Gradex extract checksum does not match the generated artifact',
      409,
      false,
    )
  }
  return { bytes, uploadedByThisAttempt }
}

function publicCompletedResult(
  result: z.infer<typeof completedOperationSchema>,
): ClassroomGradexExtractResult {
  return {
    ok: true,
    status: result.status,
    operation_id: result.operation_id,
    extract_id: result.extract_id,
    source_archive_id: result.source_archive_id,
    replayed: result.replayed,
    artifact_sha256: result.artifact_sha256,
    content_sha256: result.content_sha256,
    compressed_byte_size: result.compressed_byte_size,
    uncompressed_byte_size: result.uncompressed_byte_size,
    resource_counts: result.resource_counts,
    verification: result.verification,
    generated_at: result.generated_at,
    delete_after: result.delete_after,
  }
}

async function recordGradexFailure(args: {
  supabase: SupabaseClient
  operationId: string
  teacherId: string
  error: ClassroomGradexExtractError
}) {
  try {
    await args.supabase.rpc('fail_classroom_gradex_extract', {
      p_operation_id: args.operationId,
      p_teacher_id: args.teacherId,
      p_error_code: args.error.code,
      p_retryable: args.error.retryable,
    })
  } catch {
    // The operation result remains safe even when failure telemetry is temporarily unavailable.
  }
}

function emitGradexMetric(result: ClassroomGradexExtractResult, startedAt: number) {
  console.info('[classroom-gradex-operation]', JSON.stringify({
    operation_id: result.operation_id,
    operation_type: 'gradex_extract',
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

export async function createClassroomGradexExtract(args: {
  supabase: SupabaseClient
  operationId: string
  teacherId: string
  classroomId: string
  sourceArchiveId: string
  deleteAfter: string
}): Promise<ClassroomGradexExtractResult> {
  const startedAt = Date.now()
  const operationId = uuidSchema.parse(args.operationId)
  const teacherId = uuidSchema.parse(args.teacherId)
  const classroomId = uuidSchema.parse(args.classroomId)
  const sourceArchiveId = uuidSchema.parse(args.sourceArchiveId)
  const deleteAfter = timestampSchema.parse(args.deleteAfter)
  if (!isClassroomGradexExtractAllowed(teacherId)) {
    const result: ClassroomGradexExtractResult = {
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'classroom_gradex_extract_not_enabled',
      error: 'Classroom Gradex extracts are not enabled for this teacher',
      retryable: true,
    }
    emitGradexMetric(result, startedAt)
    return result
  }
  let hmacSecret: string
  try {
    hmacSecret = resolveClassroomGradexHmacSecret()
  } catch {
    const result: ClassroomGradexExtractResult = {
      ok: false,
      status: 503,
      operation_id: operationId,
      error_code: 'classroom_gradex_configuration_unavailable',
      error: 'Classroom Gradex extract configuration is unavailable',
      retryable: true,
    }
    emitGradexMetric(result, startedAt)
    return result
  }
  const requestSha256 = hashClassroomGradexRequest({
    format: GRADEX_EXTRACT_FORMAT,
    version: GRADEX_EXTRACT_VERSION,
    classroom_id: classroomId,
    source_archive_id: sourceArchiveId,
    delete_after: deleteAfter,
    hmac_key_fingerprint: createHash('sha256').update(hmacSecret).digest('hex'),
  })
  let uploadedByThisAttempt = false
  let storagePath: string | null = null
  let finalizationMayHaveCommitted = false

  try {
    const beginResponse = await args.supabase.rpc('begin_classroom_gradex_extract', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_classroom_id: classroomId,
      p_source_archive_id: sourceArchiveId,
      p_request_sha256: requestSha256,
      p_delete_after: deleteAfter,
    })
    if (beginResponse.error) {
      const missingMigration = isMissingGradexRpc(beginResponse.error)
      throw new ClassroomGradexExtractError(
        missingMigration ? 'classroom_gradex_migration_required' : 'gradex_operation_begin_failed',
        missingMigration
          ? 'Classroom Gradex extracts require migration 084'
          : 'Gradex extract operation could not be started',
        503,
        true,
      )
    }

    const parsedBegin = beginOperationResultSchema.safeParse(beginResponse.data)
    if (!parsedBegin.success) {
      throw new ClassroomGradexExtractError(
        'gradex_rpc_contract_invalid',
        'Gradex extract operation returned an invalid contract',
        500,
        false,
      )
    }
    assertOperationIdentity({
      result: parsedBegin.data,
      operationId,
      sourceArchiveId,
      teacherId,
      classroomId,
      deleteAfter,
    })
    if (!parsedBegin.data.ok) {
      emitGradexMetric(parsedBegin.data, startedAt)
      return parsedBegin.data
    }
    if (parsedBegin.data.operation_status === 'completed') {
      assertExactResourceCounts(parsedBegin.data.resource_counts)
      const result = publicCompletedResult(parsedBegin.data)
      emitGradexMetric(result, startedAt)
      return result
    }

    const snapshot = parsedBegin.data
    storagePath = snapshot.storage_path
    const metadata = await loadSourceArchiveMetadata({
      supabase: args.supabase,
      archiveId: sourceArchiveId,
      classroomId,
      teacherId,
    })
    if (
      metadata.id !== snapshot.source_archive_id ||
      metadata.artifact_sha256 !== snapshot.source_archive_sha256
    ) {
      throw new ClassroomGradexExtractError(
        'gradex_source_archive_metadata_mismatch',
        'Source archive metadata does not match the durable operation snapshot',
        409,
        false,
      )
    }

    const archiveBytes = await downloadSourceArchive({
      supabase: args.supabase,
      bucket: metadata.storage_bucket,
      path: metadata.storage_path,
    })
    if (sha256Bytes(archiveBytes) !== snapshot.source_archive_sha256) {
      throw new ClassroomGradexExtractError(
        'gradex_source_archive_checksum_mismatch',
        'Source archive bytes do not match immutable verified metadata',
        409,
        false,
      )
    }
    const verifiedArchive = verifyClassroomArchiveBundle(archiveBytes)
    if (!verifiedArchive.ok) {
      throw new ClassroomGradexExtractError(
        'gradex_source_archive_verification_failed',
        'Source archive failed strict verification',
        409,
        false,
      )
    }
    if (
      verifiedArchive.manifest.archive_id !== sourceArchiveId ||
      verifiedArchive.manifest.classroom_id !== classroomId ||
      verifiedArchive.manifest.teacher_id !== teacherId
    ) {
      throw new ClassroomGradexExtractError(
        'gradex_source_archive_identity_mismatch',
        'Source archive identity does not match the Gradex operation',
        409,
        false,
      )
    }

    let bundle: ReturnType<typeof buildGradexExtractFromClassroomArchive>
    try {
      bundle = buildGradexExtractFromClassroomArchive({
        archive: archiveBytes,
        extractId: snapshot.extract_id,
        generatedAt: snapshot.generated_at,
        deleteAfter: snapshot.delete_after,
        hmacSecret,
      })
    } catch {
      throw new ClassroomGradexExtractError(
        'gradex_transform_failed',
        'Verified source archive could not be transformed into a safe Gradex extract',
        409,
        false,
      )
    }
    if (bundle.extract.byteLength > CLASSROOM_GRADEX_EXTRACT_MAX_BYTES) {
      throw new ClassroomGradexExtractError(
        'gradex_extract_exceeds_free_plan_file_limit',
        'Gradex extract exceeds the 50 MB Supabase Free upload limit',
        413,
        false,
      )
    }

    const stored = await uploadAndReadBackExtract({
      supabase: args.supabase,
      operationId,
      storagePath,
      extract: bundle.extract,
      artifactSha256: bundle.artifactSha256,
    })
    uploadedByThisAttempt = stored.uploadedByThisAttempt
    const verifiedExtract = verifyGradexExtractBundle(stored.bytes)
    if (!verifiedExtract.ok) {
      throw new ClassroomGradexExtractError(
        'gradex_readback_verification_failed',
        'Stored Gradex extract failed independent privacy and integrity verification',
        409,
        false,
      )
    }
    if (
      verifiedExtract.manifest.extract_id !== snapshot.extract_id ||
      verifiedExtract.manifest.source_archive_ref !== snapshot.source_archive_sha256 ||
      verifiedExtract.manifest.generated_at !== snapshot.generated_at ||
      verifiedExtract.manifest.delete_after !== snapshot.delete_after ||
      verifiedExtract.manifest.content_sha256 !== bundle.manifest.content_sha256
    ) {
      throw new ClassroomGradexExtractError(
        'gradex_readback_manifest_mismatch',
        'Stored Gradex extract manifest does not match the durable operation',
        409,
        false,
      )
    }
    const resourceCounts = Object.fromEntries(
      verifiedExtract.manifest.resources.map((resource) => [resource.table, resource.row_count]),
    )
    assertExactResourceCounts(resourceCounts)
    const verifiedAt = new Date(
      Math.max(Date.now(), Date.parse(snapshot.generated_at)),
    ).toISOString()
    const verification = gradexVerificationSchema.parse({
      source_archive_checksum_verified: true,
      source_archive_manifest_verified: true,
      resource_checksums_verified: true,
      resource_counts_verified: true,
      structured_privacy_verified: true,
      pseudonym_relationships_verified: true,
      storage_objects_excluded: true,
      read_back_verified: true,
      artifact_checksum_verified: true,
      direct_identifier_findings: 0,
      verified_at: verifiedAt,
    })

    finalizationMayHaveCommitted = true
    const completeResponse = await args.supabase.rpc('complete_classroom_gradex_extract', {
      p_operation_id: operationId,
      p_teacher_id: teacherId,
      p_artifact_sha256: bundle.artifactSha256,
      p_content_sha256: bundle.manifest.content_sha256,
      p_compressed_byte_size: bundle.extract.byteLength,
      p_uncompressed_byte_size: bundle.uncompressedByteSize,
      p_resource_counts: resourceCounts,
      p_verification: verification,
    })
    if (completeResponse.error) {
      throw new ClassroomGradexExtractError(
        isMissingGradexRpc(completeResponse.error)
          ? 'classroom_gradex_migration_required'
          : 'gradex_finalize_failed',
        'Gradex extract could not be finalized',
        503,
        true,
      )
    }
    const parsedComplete = completeOperationResultSchema.safeParse(completeResponse.data)
    if (!parsedComplete.success) {
      throw new ClassroomGradexExtractError(
        'gradex_rpc_contract_invalid',
        'Gradex extract finalization returned an invalid contract',
        500,
        false,
      )
    }
    assertOperationIdentity({
      result: parsedComplete.data,
      operationId,
      sourceArchiveId,
      teacherId,
      classroomId,
      deleteAfter,
    })
    if (!parsedComplete.data.ok) {
      if (!parsedComplete.data.retryable && uploadedByThisAttempt) {
        await removeGradexObject({ supabase: args.supabase, operationId, storagePath })
      }
      emitGradexMetric(parsedComplete.data, startedAt)
      return parsedComplete.data
    }
    if (
      parsedComplete.data.artifact_sha256 !== bundle.artifactSha256 ||
      parsedComplete.data.content_sha256 !== bundle.manifest.content_sha256 ||
      parsedComplete.data.compressed_byte_size !== bundle.extract.byteLength ||
      parsedComplete.data.uncompressed_byte_size !== bundle.uncompressedByteSize ||
      canonicalJsonStringify(parsedComplete.data.resource_counts) !==
        canonicalJsonStringify(resourceCounts) ||
      canonicalJsonStringify(parsedComplete.data.verification) !==
        canonicalJsonStringify(verification) ||
      parsedComplete.data.generated_at !== snapshot.generated_at
    ) {
      throw new ClassroomGradexExtractError(
        'gradex_finalization_contract_mismatch',
        'Finalized Gradex metadata does not match the verified artifact',
        500,
        false,
      )
    }

    const result = publicCompletedResult(parsedComplete.data)
    emitGradexMetric(result, startedAt)
    return result
  } catch (error) {
    const gradexError = error instanceof ClassroomGradexExtractError
      ? error
      : new ClassroomGradexExtractError(
          'gradex_extract_failed',
          'Gradex extract generation failed',
          500,
          false,
        )
    if (
      !gradexError.retryable &&
      uploadedByThisAttempt &&
      storagePath &&
      !finalizationMayHaveCommitted
    ) {
      await removeGradexObject({ supabase: args.supabase, operationId, storagePath })
    }
    await recordGradexFailure({
      supabase: args.supabase,
      operationId,
      teacherId,
      error: gradexError,
    })
    const result: ClassroomGradexExtractResult = {
      ok: false,
      status: gradexError.status,
      operation_id: operationId,
      error_code: gradexError.code,
      error: gradexError.message,
      retryable: gradexError.retryable,
    }
    emitGradexMetric(result, startedAt)
    return result
  }
}
