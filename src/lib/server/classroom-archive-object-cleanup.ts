import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { missingStorageObjectEvidence } from '@/lib/server/storage-object-evidence'
import { getServiceRoleClient } from '@/lib/supabase'

export const CLASSROOM_ARCHIVE_OBJECT_CLEANUP_MAX_CLAIMS = 25
export const CLASSROOM_ARCHIVE_OBJECT_CLEANUP_DEFAULT_LEASE_SECONDS = 300

const uuidSchema = z.string().uuid()
const bucketSchema = z.enum([
  'classroom-archives',
  'assignment-artifacts',
  'submission-images',
  'test-documents',
])
const claimSchema = z.object({
  operation_id: uuidSchema,
  storage_bucket: bucketSchema,
  storage_path: z.string().min(1),
  attempt_count: z.number().int().positive(),
}).strict().superRefine((claim, context) => {
  const segments = claim.storage_path.split('/')
  const isExportPath = claim.storage_bucket === 'classroom-archives'
    && segments.length === 4
    && uuidSchema.safeParse(segments[0]).success
    && uuidSchema.safeParse(segments[1]).success
    && segments[2] === claim.operation_id
    && segments[3] === 'classroom-v1.tar.gz'
  const isRestorePath = claim.storage_bucket !== 'classroom-archives'
    && segments.length === 4
    && segments[0] === 'restores'
    && uuidSchema.safeParse(segments[1]).success
    && segments[2] === claim.operation_id
    && /^[a-f0-9]{64}-[a-f0-9]{64}$/.test(segments[3] || '')
  if (!isExportPath && !isRestorePath) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Archive object cleanup path does not match its operation identity',
      path: ['storage_path'],
    })
  }
})
const booleanRpcSchema = z.boolean()

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type CleanupClaim = z.infer<typeof claimSchema>

export type ClassroomArchiveObjectCleanupItemResult = {
  operation_id: string
  object_ref: string
  attempt_count: number
  status: 'deleted' | 'failed'
  error_code?: string
  retry_recorded?: boolean
}

export type ClassroomArchiveObjectCleanupResult =
  | {
      ok: true
      status: 200
      lease_token: string
      claimed: number
      deleted: number
      failed: number
      retry_recording_failed: number
      results: ClassroomArchiveObjectCleanupItemResult[]
    }
  | {
      ok: false
      status: 500 | 503
      lease_token: string
      error_code: string
      error: string
      retryable: boolean
    }

export function isClassroomArchiveObjectCleanupEnabled(): boolean {
  return process.env.CLASSROOM_ARCHIVE_OBJECT_CLEANUP_ENABLED?.trim().toLowerCase() === 'true'
}

export function resolveClassroomArchiveObjectCleanupLeaseToken(): string {
  return randomUUID()
}

function objectRef(claim: CleanupClaim): string {
  return createHash('sha256')
    .update(`${claim.storage_bucket}\0${claim.storage_path}`)
    .digest('hex')
}

function isMissingCleanupRpc(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return error.code === '42883' || error.code === 'PGRST202' || (
    message.includes('classroom_archive_object_upload_cleanup')
  )
}

async function isAuthoritativeMissingObject(
  supabase: SupabaseClient,
  bucket: z.infer<typeof bucketSchema>,
  error: unknown,
): Promise<boolean> {
  const evidence = missingStorageObjectEvidence(error)
  if (evidence === 'object') return true
  if (evidence !== 'generic') return false
  try {
    const response = await supabase.storage.getBucket(bucket)
    return !response.error && response.data?.id === bucket
  } catch {
    return false
  }
}

async function recordFailure(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  errorCode: string
}): Promise<boolean> {
  try {
    const response = await args.supabase.rpc('fail_classroom_archive_object_upload_cleanup', {
      p_operation_id: args.claim.operation_id,
      p_storage_bucket: args.claim.storage_bucket,
      p_storage_path: args.claim.storage_path,
      p_lease_token: args.leaseToken,
      p_error_code: args.errorCode,
    })
    const parsed = !response.error ? booleanRpcSchema.safeParse(response.data) : null
    return Boolean(parsed?.success && parsed.data)
  } catch {
    return false
  }
}

async function failedItem(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  errorCode: string
}): Promise<ClassroomArchiveObjectCleanupItemResult> {
  return {
    operation_id: args.claim.operation_id,
    object_ref: objectRef(args.claim),
    attempt_count: args.claim.attempt_count,
    status: 'failed',
    error_code: args.errorCode,
    retry_recorded: await recordFailure(args),
  }
}

async function processClaim(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  leaseSeconds: number
}): Promise<ClassroomArchiveObjectCleanupItemResult> {
  const renewal = await args.supabase.rpc(
    'renew_classroom_archive_object_upload_cleanup_lease',
    {
      p_operation_id: args.claim.operation_id,
      p_storage_bucket: args.claim.storage_bucket,
      p_storage_path: args.claim.storage_path,
      p_lease_token: args.leaseToken,
      p_lease_seconds: args.leaseSeconds,
    },
  )
  const renewed = !renewal.error ? booleanRpcSchema.safeParse(renewal.data) : null
  if (!renewed?.success || !renewed.data) {
    return {
      operation_id: args.claim.operation_id,
      object_ref: objectRef(args.claim),
      attempt_count: args.claim.attempt_count,
      status: 'failed',
      error_code: 'archive_object_cleanup_lease_lost',
      retry_recorded: false,
    }
  }

  const bucket = args.supabase.storage.from(args.claim.storage_bucket)
  let removeFailed = false
  try {
    const response = await bucket.remove([args.claim.storage_path])
    removeFailed = Boolean(response.error)
  } catch {
    removeFailed = true
  }

  let absent = false
  let present = false
  try {
    const response = await bucket.download(args.claim.storage_path)
    present = Boolean(response.data)
    absent = !response.data && await isAuthoritativeMissingObject(
      args.supabase,
      args.claim.storage_bucket,
      response.error,
    )
  } catch (error) {
    absent = await isAuthoritativeMissingObject(
      args.supabase,
      args.claim.storage_bucket,
      error,
    )
  }
  if (!absent) {
    return failedItem({
      ...args,
      errorCode: present
        ? removeFailed
          ? 'archive_storage_delete_failed'
          : 'archive_storage_delete_unconfirmed'
        : 'archive_storage_delete_verification_failed',
    })
  }

  try {
    const response = await args.supabase.rpc(
      'complete_classroom_archive_object_upload_cleanup',
      {
        p_operation_id: args.claim.operation_id,
        p_storage_bucket: args.claim.storage_bucket,
        p_storage_path: args.claim.storage_path,
        p_lease_token: args.leaseToken,
      },
    )
    const completed = !response.error ? booleanRpcSchema.safeParse(response.data) : null
    if (completed?.success && completed.data) {
      return {
        operation_id: args.claim.operation_id,
        object_ref: objectRef(args.claim),
        attempt_count: args.claim.attempt_count,
        status: 'deleted',
      }
    }
    if (completed?.success) {
      return {
        operation_id: args.claim.operation_id,
        object_ref: objectRef(args.claim),
        attempt_count: args.claim.attempt_count,
        status: 'failed',
        error_code: 'archive_object_cleanup_completion_rejected',
        retry_recorded: false,
      }
    }
  } catch {
    // Record the retry below if the lease is still current.
  }
  return failedItem({ ...args, errorCode: 'archive_object_cleanup_completion_failed' })
}

export async function runClassroomArchiveObjectCleanup(args: {
  supabase: SupabaseClient
  leaseToken: string
  limit?: number
  leaseSeconds?: number
}): Promise<ClassroomArchiveObjectCleanupResult> {
  const leaseToken = uuidSchema.parse(args.leaseToken)
  const limit = z.number().int().min(1).max(CLASSROOM_ARCHIVE_OBJECT_CLEANUP_MAX_CLAIMS)
    .parse(args.limit ?? CLASSROOM_ARCHIVE_OBJECT_CLEANUP_MAX_CLAIMS)
  const leaseSeconds = z.number().int().min(30).max(1800)
    .parse(args.leaseSeconds ?? CLASSROOM_ARCHIVE_OBJECT_CLEANUP_DEFAULT_LEASE_SECONDS)
  if (!isClassroomArchiveObjectCleanupEnabled()) {
    return {
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'classroom_archive_object_cleanup_not_enabled',
      error: 'Classroom archive object cleanup is not enabled',
      retryable: true,
    }
  }

  try {
    const response = await args.supabase.rpc('claim_due_classroom_archive_object_upload_cleanup', {
      p_lease_token: leaseToken,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    })
    if (response.error) {
      const migrationRequired = isMissingCleanupRpc(response.error)
      return {
        ok: false,
        status: 503,
        lease_token: leaseToken,
        error_code: migrationRequired
          ? 'classroom_archive_object_cleanup_migration_required'
          : 'archive_object_cleanup_claim_failed',
        error: migrationRequired
          ? 'Classroom archive object cleanup requires migration 083'
          : 'Classroom archive object cleanup could not be claimed',
        retryable: true,
      }
    }
    const parsed = z.array(claimSchema).safeParse(response.data)
    if (!parsed.success || parsed.data.length > limit) {
      return {
        ok: false,
        status: 500,
        lease_token: leaseToken,
        error_code: 'archive_object_cleanup_claim_contract_invalid',
        error: 'Classroom archive object cleanup returned an invalid contract',
        retryable: false,
      }
    }
    const identities = new Set<string>()
    for (const claim of parsed.data) {
      const identity = `${claim.operation_id}\0${claim.storage_bucket}\0${claim.storage_path}`
      if (identities.has(identity)) {
        return {
          ok: false,
          status: 500,
          lease_token: leaseToken,
          error_code: 'archive_object_cleanup_claim_contract_invalid',
          error: 'Classroom archive object cleanup returned an invalid contract',
          retryable: false,
        }
      }
      identities.add(identity)
    }

    const results: ClassroomArchiveObjectCleanupItemResult[] = []
    for (const claim of parsed.data) {
      try {
        results.push(await processClaim({
          supabase: args.supabase,
          claim,
          leaseToken,
          leaseSeconds,
        }))
      } catch {
        results.push(await failedItem({
          supabase: args.supabase,
          claim,
          leaseToken,
          errorCode: 'archive_object_cleanup_unexpected_failure',
        }))
      }
    }
    const deleted = results.filter((result) => result.status === 'deleted').length
    return {
      ok: true,
      status: 200,
      lease_token: leaseToken,
      claimed: results.length,
      deleted,
      failed: results.length - deleted,
      retry_recording_failed: results.filter(
        (result) => result.status === 'failed' && !result.retry_recorded,
      ).length,
      results,
    }
  } catch {
    return {
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'archive_object_cleanup_claim_failed',
      error: 'Classroom archive object cleanup could not be claimed',
      retryable: true,
    }
  }
}
