import { z } from 'zod'

export const managedSourceBucketSchema = z.enum([
  'assignment-artifacts',
  'submission-images',
  'test-documents',
])

export const managedStorageBucketSchema = z.enum([
  ...managedSourceBucketSchema.options,
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

const managedStorageStatusSchema = z.enum([
  'pending_upload',
  'ready',
  'cleanup_pending',
  'cleanup_processing',
  'purging',
])

export const managedStorageObjectSchema = z.object({
  id: z.string().uuid(),
  storage_bucket: managedStorageBucketSchema,
  storage_path: z.string().min(1),
  classroom_id: z.string().uuid().nullable(),
  course_blueprint_id: z.string().uuid().nullable(),
  purpose: managedStoragePurposeSchema,
  status: managedStorageStatusSchema,
  created_by_user_id: z.string().uuid().nullable(),
  data_subject_user_id: z.string().uuid().nullable(),
  resource_type: z.string().nullable(),
  resource_id: z.string().uuid().nullable(),
  content_type: z.string().nullable(),
  byte_size: z.coerce.number().int().nonnegative().nullable(),
  content_sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  upload_expires_at: z.string().datetime({ offset: true }).nullable(),
  attempt_count: z.number().int().nonnegative(),
  next_attempt_at: z.string().datetime({ offset: true }),
  lease_token: z.string().uuid().nullable(),
  lease_expires_at: z.string().datetime({ offset: true }).nullable(),
  last_error_code: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  ready_at: z.string().datetime({ offset: true }).nullable(),
  updated_at: z.string().datetime({ offset: true }),
}).passthrough()

export type ManagedSourceBucket = z.infer<typeof managedSourceBucketSchema>
export type ManagedStorageBucket = z.infer<typeof managedStorageBucketSchema>
export type ManagedStoragePurpose = z.infer<typeof managedStoragePurposeSchema>
export type ManagedStorageObject = z.infer<typeof managedStorageObjectSchema>

type SupabaseLike = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
}

export class ManagedStorageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ManagedStorageError'
  }
}

function rpcError(
  error: { code?: string; message?: string } | null,
  fallbackCode: string,
  fallbackMessage: string,
): ManagedStorageError {
  const message = error?.message || fallbackMessage
  const missing = error?.code === 'PGRST202'
    || error?.code === '42883'
    || message.includes('begin_managed_storage_upload')
  return new ManagedStorageError(
    missing ? 'managed_storage_migration_required' : error?.code || fallbackCode,
    missing ? 'Managed file ownership requires migration 117' : message,
  )
}

export async function reserveManagedStorageUpload(input: {
  supabase: SupabaseLike
  objectId: string
  bucket: ManagedStorageBucket
  path: string
  classroomId?: string | null
  courseBlueprintId?: string | null
  purpose: ManagedStoragePurpose
  createdByUserId: string
  dataSubjectUserId?: string | null
  resourceType?: string | null
  resourceId?: string | null
  contentType?: string | null
  byteSize?: number | null
}): Promise<ManagedStorageObject> {
  const { data, error } = await input.supabase.rpc('begin_managed_storage_upload', {
    p_object_id: input.objectId,
    p_storage_bucket: input.bucket,
    p_storage_path: input.path,
    p_classroom_id: input.classroomId ?? null,
    p_course_blueprint_id: input.courseBlueprintId ?? null,
    p_purpose: input.purpose,
    p_created_by_user_id: input.createdByUserId,
    p_data_subject_user_id: input.dataSubjectUserId ?? null,
    p_resource_type: input.resourceType ?? null,
    p_resource_id: input.resourceId ?? null,
    p_content_type: input.contentType ?? null,
    p_byte_size: input.byteSize ?? null,
  })
  if (error) {
    throw rpcError(error, 'managed_storage_reservation_failed', 'Could not reserve managed file')
  }
  return managedStorageObjectSchema.parse(data)
}

export async function adoptManagedStorageUpload(input: {
  supabase: SupabaseLike
  objectId: string
  contentSha256?: string | null
}): Promise<ManagedStorageObject> {
  const { data, error } = await input.supabase.rpc('adopt_managed_storage_upload', {
    p_object_id: input.objectId,
    p_content_sha256: input.contentSha256 ?? null,
  })
  if (error) {
    throw rpcError(error, 'managed_storage_adoption_failed', 'Could not adopt managed file')
  }
  return managedStorageObjectSchema.parse(data)
}

export async function queueManagedStorageCleanup(input: {
  supabase: SupabaseLike
  objectId: string
  errorCode?: string | null
}): Promise<boolean> {
  const { data, error } = await input.supabase.rpc('queue_managed_storage_cleanup', {
    p_object_id: input.objectId,
    p_error_code: input.errorCode ?? null,
  })
  if (error) {
    throw rpcError(error, 'managed_storage_cleanup_queue_failed', 'Could not queue managed file cleanup')
  }
  return z.boolean().parse(data)
}

export async function queueClassroomManagedStorageCleanup(input: {
  supabase: SupabaseLike
  objectId: string
  classroomId: string
  bucket: ManagedSourceBucket
  path: string
  purpose: ManagedStoragePurpose
  resourceType: string
  resourceId: string
  errorCode?: string | null
}): Promise<boolean> {
  const { data, error } = await input.supabase.rpc(
    'queue_classroom_managed_storage_cleanup',
    {
      p_object_id: input.objectId,
      p_classroom_id: input.classroomId,
      p_storage_bucket: input.bucket,
      p_storage_path: input.path,
      p_purpose: input.purpose,
      p_resource_type: input.resourceType,
      p_resource_id: input.resourceId,
      p_error_code: input.errorCode ?? null,
    },
  )
  if (error) {
    throw rpcError(error, 'managed_storage_cleanup_queue_failed', 'Could not queue managed file cleanup')
  }
  return z.boolean().parse(data)
}

export async function queueManagedStorageCleanupPath(input: {
  supabase: SupabaseLike
  bucket: ManagedStorageBucket
  path: string
  errorCode?: string | null
}): Promise<boolean> {
  const { data, error } = await input.supabase.rpc(
    'queue_managed_storage_cleanup_path',
    {
      p_storage_bucket: input.bucket,
      p_storage_path: input.path,
      p_error_code: input.errorCode ?? null,
    },
  )
  if (error) {
    throw rpcError(error, 'managed_storage_cleanup_queue_failed', 'Could not queue managed file cleanup')
  }
  return z.boolean().parse(data)
}
