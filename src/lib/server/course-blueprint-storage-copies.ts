import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'

const storageCopyItemSchema = z.object({
  id: z.string().uuid(),
  operation_id: z.string().uuid(),
  source_object_id: z.string().uuid(),
  source_storage_bucket: z.enum([
    'assignment-artifacts',
    'submission-images',
    'test-documents',
  ]),
  source_storage_path: z.string().min(1),
  target_storage_bucket: z.enum([
    'assignment-artifacts',
    'submission-images',
    'test-documents',
  ]),
  target_storage_path: z.string().min(1),
  content_type: z.string().nullable(),
  expected_byte_size: z.coerce.number().int().nonnegative().nullable(),
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
}).passthrough()

const adoptionResultSchema = z.object({
  ok: z.boolean(),
  error_code: z.string().optional(),
  retryable: z.boolean().optional(),
}).passthrough()

type StorageCopyItem = z.infer<typeof storageCopyItemSchema>

type StorageBucket = {
  download(path: string): Promise<{ data: Blob | null; error: { message?: string } | null }>
  upload(
    path: string,
    body: Uint8Array,
    options: { contentType: string; upsert: boolean },
  ): Promise<{ error: { message?: string } | null }>
  getPublicUrl(path: string): { data: { publicUrl: string } }
}

type BlueprintStorageCopyClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
  storage: { from(bucket: string): StorageBucket }
}

export class CourseBlueprintStorageCopyError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable: boolean,
    message: string,
  ) {
    super(message)
    this.name = 'CourseBlueprintStorageCopyError'
  }
}

async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function rpcFailure(
  error: { code?: string; message?: string } | null,
  fallbackCode: string,
): CourseBlueprintStorageCopyError {
  return new CourseBlueprintStorageCopyError(
    error?.code || fallbackCode,
    true,
    error?.message || 'Course material copy paused and can be retried',
  )
}

async function adoptCopiedObjects(input: {
  supabase: BlueprintStorageCopyClient
  operationId: string
  teacherId: string
}) {
  const { data, error } = await input.supabase.rpc(
    'adopt_course_blueprint_storage_copies',
    {
      p_operation_id: input.operationId,
      p_teacher_id: input.teacherId,
    },
  )
  if (error) throw rpcFailure(error, 'blueprint_storage_copy_adoption_failed')
  return adoptionResultSchema.parse(data)
}

async function failCopy(input: {
  supabase: BlueprintStorageCopyClient
  itemId: string
  teacherId: string
  leaseToken: string
  errorCode: string
  retryable: boolean
}) {
  const failed = await input.supabase.rpc('fail_course_blueprint_storage_copy', {
    p_item_id: input.itemId,
    p_teacher_id: input.teacherId,
    p_lease_token: input.leaseToken,
    p_error_code: input.errorCode,
    p_retryable: input.retryable,
  })
  if (failed.error) throw rpcFailure(
    failed.error, 'blueprint_storage_copy_failure_record_failed',
  )
  if (failed.data !== true) throw new CourseBlueprintStorageCopyError(
    'blueprint_storage_copy_failure_record_race',
    true,
    'Course material copy changed before its failure was recorded',
  )
}

async function copyClaimedObject(input: {
  supabase: BlueprintStorageCopyClient
  teacherId: string
  leaseToken: string
  item: StorageCopyItem
}) {
  const { supabase, teacherId, leaseToken, item } = input
  try {
    const targetBucket = supabase.storage.from(item.target_storage_bucket)
    const sourceBucket = supabase.storage.from(item.source_storage_bucket)
    const source = await sourceBucket.download(item.source_storage_path)
    if (source.error || !source.data) {
      throw new CourseBlueprintStorageCopyError(
        'blueprint_storage_copy_source_missing',
        true,
        source.error?.message || 'Course material source file is unavailable',
      )
    }
    const sourceBytes = await readBlobBytes(source.data)
    const sourceSha256 = sha256(sourceBytes)
    if (
      (item.expected_byte_size !== null && item.expected_byte_size !== sourceBytes.byteLength)
      || (item.expected_sha256 !== null && item.expected_sha256 !== sourceSha256)
    ) {
      throw new CourseBlueprintStorageCopyError(
        'blueprint_storage_copy_source_changed',
        false,
        'Course material changed after the copy was planned',
      )
    }

    const upload = await targetBucket.upload(item.target_storage_path, sourceBytes, {
      contentType: item.content_type || 'application/octet-stream',
      upsert: false,
    })
    if (upload.error) {
      // A worker can expire after uploading but before recording completion.
      // The deterministic target key makes the next attempt verify and adopt
      // that exact object instead of overwriting it.
      const existing = await targetBucket.download(item.target_storage_path)
      if (existing.error || !existing.data) {
        throw new CourseBlueprintStorageCopyError(
          'blueprint_storage_copy_upload_failed',
          true,
          upload.error.message || 'Course material copy upload failed',
        )
      }
    }

    const readBack = await targetBucket.download(item.target_storage_path)
    if (readBack.error || !readBack.data) {
      throw new CourseBlueprintStorageCopyError(
        'blueprint_storage_copy_verification_failed',
        true,
        readBack.error?.message || 'Copied course material could not be verified',
      )
    }
    const targetBytes = await readBlobBytes(readBack.data)
    if (
      targetBytes.byteLength !== sourceBytes.byteLength
      || sha256(targetBytes) !== sourceSha256
    ) {
      // A physical key is a single immutable generation. Abandon the bad
      // generation and atomically reserve a new owned target; cleanup of the
      // old key is independent and the key is never reused.
      const rotation = await supabase.rpc('rotate_course_blueprint_storage_copy_target', {
        p_item_id: item.id,
        p_teacher_id: teacherId,
        p_lease_token: leaseToken,
        p_target_object_id: randomUUID(),
      })
      if (rotation.error) {
        throw rpcFailure(rotation.error, 'blueprint_storage_copy_generation_rotation_failed')
      }
      if (rotation.data !== true) {
        throw new CourseBlueprintStorageCopyError(
          'blueprint_storage_copy_generation_lease_lost',
          true,
          'Course material copy lease expired before a replacement was reserved',
        )
      }
      return
    }

    const publicUrl = targetBucket.getPublicUrl(item.target_storage_path).data.publicUrl
    const completion = await supabase.rpc('complete_course_blueprint_storage_copy', {
      p_item_id: item.id,
      p_teacher_id: teacherId,
      p_lease_token: leaseToken,
      p_target_public_url: publicUrl,
      p_byte_size: targetBytes.byteLength,
      p_content_sha256: sourceSha256,
    })
    if (completion.error) {
      throw rpcFailure(completion.error, 'blueprint_storage_copy_completion_failed')
    }
    if (completion.data !== true) {
      throw new CourseBlueprintStorageCopyError(
        'blueprint_storage_copy_lease_lost',
        true,
        'Course material copy lease expired before completion',
      )
    }
  } catch (error) {
    const copyError = error instanceof CourseBlueprintStorageCopyError
      ? error
      : new CourseBlueprintStorageCopyError(
          'blueprint_storage_copy_failed',
          true,
          error instanceof Error ? error.message : 'Course material copy failed',
        )
    await failCopy({
      supabase,
      itemId: item.id,
      teacherId,
      leaseToken,
      errorCode: copyError.code,
      retryable: copyError.retryable,
    })
    throw copyError
  }
}

export async function resumeCourseBlueprintStorageCopies(input: {
  operationId: string
  teacherId: string
  supabase?: BlueprintStorageCopyClient
}): Promise<void> {
  const supabase = input.supabase
    ?? (getServiceRoleClient() as unknown as BlueprintStorageCopyClient)

  const initialAdoption = await adoptCopiedObjects({
    supabase,
    operationId: input.operationId,
    teacherId: input.teacherId,
  })
  if (initialAdoption.ok) return

  for (let copied = 0; copied < 500; copied += 1) {
    const leaseToken = randomUUID()
    const { data, error } = await supabase.rpc(
      'claim_course_blueprint_storage_copy',
      {
        p_operation_id: input.operationId,
        p_teacher_id: input.teacherId,
        p_lease_token: leaseToken,
        p_lease_seconds: 120,
      },
    )
    if (error) throw rpcFailure(error, 'blueprint_storage_copy_claim_failed')
    const claims = z.array(storageCopyItemSchema).parse(data ?? [])
    if (claims.length === 0) {
      const adoption = await adoptCopiedObjects({
        supabase,
        operationId: input.operationId,
        teacherId: input.teacherId,
      })
      if (adoption.ok) return
      throw new CourseBlueprintStorageCopyError(
        adoption.error_code || 'blueprint_storage_copy_incomplete',
        adoption.retryable ?? true,
        'Course material copy is still active and can be resumed',
      )
    }
    await copyClaimedObject({
      supabase,
      teacherId: input.teacherId,
      leaseToken,
      item: claims[0],
    })
  }

  throw new CourseBlueprintStorageCopyError(
    'blueprint_storage_copy_limit_exceeded',
    true,
    'Course material copy paused after 500 files and can be resumed',
  )
}
