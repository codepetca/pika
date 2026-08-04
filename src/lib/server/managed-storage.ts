import { z } from 'zod'

export const managedStorageBucketSchema = z.enum([
  'assignment-artifacts',
  'submission-images',
  'test-documents',
  'classroom-archives',
  'gradex-analytics-extracts',
])

export const managedStoragePurposeSchema = z.enum([
  'student_assignment_artifact',
  'student_inline_image',
  'teacher_test_material',
  'test_execution_snapshot',
  'legacy_classroom_file',
  'classroom_archive',
  'gradex_extract',
])

const managedStorageObjectSchema = z.object({
  id: z.string().uuid(),
  storage_bucket: managedStorageBucketSchema,
  storage_path: z.string().min(1),
  status: z.enum([
    'reserved',
    'verified',
    'ready',
    'cleanup_pending',
    'cleanup_processing',
  ]),
}).passthrough()

export type ManagedStorageBucket = z.infer<typeof managedStorageBucketSchema>
export type ManagedStoragePurpose = z.infer<typeof managedStoragePurposeSchema>
export type ManagedStorageObject = z.infer<typeof managedStorageObjectSchema>

type RpcError = { code?: string; message?: string; details?: string }
type SupabaseLike = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: RpcError | null }>
}

function isMissingFoundation(error: RpcError | null): boolean {
  const details = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return error?.code === 'PGRST202'
    || error?.code === '42883'
    || details.includes('begin_managed_storage_upload')
    || details.includes('verify_managed_storage_upload')
}

export class ManagedStorageError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message)
    this.name = 'ManagedStorageError'
  }
}

export async function reserveManagedStorageUpload(input: {
  supabase: SupabaseLike
  objectId: string
  bucket: ManagedStorageBucket
  path: string
  classroomId?: string | null
  courseBlueprintId?: string | null
  provisionalOwnerId?: string | null
  purpose: ManagedStoragePurpose
  createdByUserId: string
  dataSubjectUserId?: string | null
  resourceType?: string | null
  resourceId?: string | null
  contentType?: string | null
  byteSize?: number | null
  allowLegacyCompatibility?: boolean
}): Promise<ManagedStorageObject | null> {
  if (typeof input.supabase.rpc !== 'function') {
    if (input.allowLegacyCompatibility) return null
    throw new ManagedStorageError(
      'managed_storage_migration_required',
      'Managed file ownership requires migration 117',
    )
  }
  let response: { data: unknown; error: RpcError | null }
  try {
    response = await input.supabase.rpc('begin_managed_storage_upload', {
      p_object_id: input.objectId,
      p_storage_bucket: input.bucket,
      p_storage_path: input.path,
      p_classroom_id: input.classroomId ?? null,
      p_course_blueprint_id: input.courseBlueprintId ?? null,
      p_provisional_owner_id: input.provisionalOwnerId ?? null,
      p_purpose: input.purpose,
      p_created_by_user_id: input.createdByUserId,
      p_data_subject_user_id: input.dataSubjectUserId ?? null,
      p_resource_type: input.resourceType ?? null,
      p_resource_id: input.resourceId ?? null,
      p_content_type: input.contentType ?? null,
      p_byte_size: input.byteSize ?? null,
    })
  } catch (error) {
    if (input.allowLegacyCompatibility && error instanceof Error
      && (error.message.includes('Unexpected RPC') || error instanceof TypeError)) {
      return null
    }
    throw error
  }
  const { data, error } = response
  if (error) {
    if (input.allowLegacyCompatibility && isMissingFoundation(error)) return null
    throw new ManagedStorageError(
      isMissingFoundation(error) ? 'managed_storage_migration_required' : error.code || 'managed_storage_reservation_failed',
      isMissingFoundation(error)
        ? 'Managed file ownership requires migration 117'
        : error.message || 'Could not reserve managed file',
    )
  }
  const parsed = managedStorageObjectSchema.safeParse(data)
  if (!parsed.success && input.allowLegacyCompatibility && (data === null || data === true)) {
    return null
  }
  if (!parsed.success) {
    throw new ManagedStorageError(
      'managed_storage_reservation_contract_invalid',
      'Managed file reservation returned an invalid contract',
    )
  }
  return parsed.data
}

export async function verifyManagedStorageUpload(input: {
  supabase: SupabaseLike
  objectId: string
  contentSha256?: string | null
}): Promise<ManagedStorageObject> {
  const { data, error } = await input.supabase.rpc('verify_managed_storage_upload', {
    p_object_id: input.objectId,
    p_content_sha256: input.contentSha256 ?? null,
  })
  if (error) {
    throw new ManagedStorageError(
      error.code || 'managed_storage_verification_failed',
      error.message || 'Could not verify managed file',
    )
  }
  return managedStorageObjectSchema.parse(data)
}

export async function queueManagedStorageCleanup(input: {
  supabase: SupabaseLike
  objectId: string
  errorCode: string
}): Promise<boolean> {
  const { data, error } = await input.supabase.rpc('queue_managed_storage_cleanup', {
    p_object_id: input.objectId,
    p_error_code: input.errorCode,
  })
  if (error) return false
  return data === true
}

export async function queueManagedStorageCleanupBestEffort(input: {
  supabase: SupabaseLike
  objectId: string
  errorCode: string
}): Promise<void> {
  try {
    await queueManagedStorageCleanup(input)
  } catch {
    // The expiring reservation remains durable cleanup evidence.
  }
}
