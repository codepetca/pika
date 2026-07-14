import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'

export const CLASSROOM_ARCHIVE_SOURCE_CLEANUP_MAX_CLAIMS = 10
export const CLASSROOM_ARCHIVE_SOURCE_CLEANUP_DEFAULT_LEASE_SECONDS = 300

const uuidSchema = z.string().uuid()
const storageBucketSchema = z.enum([
  'assignment-artifacts',
  'submission-images',
  'test-documents',
])
const storagePathSchema = z.string().min(1).superRefine((path, context) => {
  if (
    path.startsWith('/')
    || path.includes('\\')
    || path.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Storage path must be canonical and relative',
    })
  }
})
const claimSchema = z.object({
  operation_id: uuidSchema,
  archive_id: uuidSchema,
  classroom_id: uuidSchema,
  storage_bucket: storageBucketSchema,
  storage_path: storagePathSchema,
  expected_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  expected_byte_size: z.number().int().nonnegative().safe(),
  attempt_count: z.number().int().positive(),
}).strict()
const runOptionsSchema = z.object({
  leaseToken: uuidSchema,
  operationId: uuidSchema,
  limit: z.number().int().min(1).max(CLASSROOM_ARCHIVE_SOURCE_CLEANUP_MAX_CLAIMS).optional(),
  leaseSeconds: z.number().int().min(30).max(1800).optional(),
}).strict()
const booleanRpcSchema = z.boolean()

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type CleanupClaim = z.infer<typeof claimSchema>

export type ClassroomArchiveSourceCleanupItemResult = {
  object_ref: string
  attempt_count: number
  status: 'deleted' | 'failed'
  error_code?: string
  retry_recorded?: boolean
}

export type ClassroomArchiveSourceCleanupResult =
  | {
      ok: true
      status: 200
      lease_token: string
      claimed: number
      deleted: number
      failed: number
      retry_recording_failed: number
      results: ClassroomArchiveSourceCleanupItemResult[]
    }
  | {
      ok: false
      status: 500 | 503
      lease_token: string
      error_code: string
      error: string
      retryable: boolean
    }

type StorageErrorShape = {
  name?: unknown
  status?: unknown
  statusCode?: unknown
  code?: unknown
  error?: unknown
  originalError?: unknown
}

type ObjectReadResult =
  | { status: 'present'; bytes: Uint8Array }
  | { status: 'absent' }
  | { status: 'uncertain' }

export function isClassroomArchiveSourceCleanupEnabled(): boolean {
  return process.env.CLASSROOM_ARCHIVE_SOURCE_CLEANUP_ENABLED?.trim().toLowerCase() === 'true'
}

export function isClassroomArchiveSourceCleanupTriggerEnabled(): boolean {
  return process.env.CLASSROOM_ARCHIVE_SOURCE_CLEANUP_TRIGGER_ENABLED
    ?.trim()
    .toLowerCase() === 'true'
}

export function resolveClassroomArchiveSourceCleanupLeaseToken(
  value?: string | null,
): string {
  return value ? uuidSchema.parse(value.trim()) : randomUUID()
}

export function resolveClassroomArchiveSourceCleanupOperationId(value: string): string {
  return uuidSchema.parse(value.trim())
}

function isMissingCleanupRpc(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return error.code === '42883' || error.code === 'PGRST202' || (
    message.includes('claim_due_classroom_archive_source_object_cleanup')
    || message.includes('renew_classroom_archive_source_object_cleanup_lease')
    || message.includes('complete_classroom_archive_source_object_cleanup')
    || message.includes('fail_classroom_archive_source_object_cleanup')
  )
}

function missingObjectEvidence(
  error: unknown,
  inspectNested = true,
): 'object' | 'generic' | null {
  if (!error || typeof error !== 'object') return null
  const value = error as StorageErrorShape
  const codes = [value.statusCode, value.code, value.error]
    .filter((code): code is string | number => (
      typeof code === 'string' || typeof code === 'number'
    ))
    .map((code) => String(code).toLowerCase())
  if (codes.includes('nosuchbucket')) return null
  if (codes.includes('nosuchkey')) return 'object'
  const status = [value.status, value.statusCode]
    .map((candidate) => typeof candidate === 'number' ? candidate : Number(candidate))
    .find((candidate) => Number.isFinite(candidate))
  if (status === 404 && (
    codes.length === 0 || codes.includes('404') || codes.includes('not_found')
  )) {
    return 'generic'
  }
  if (
    inspectNested
    && value.name === 'StorageUnknownError'
    && value.originalError
    && typeof value.originalError === 'object'
  ) {
    const originalError = value.originalError as StorageErrorShape
    const originalStatus = typeof originalError.status === 'number'
      ? originalError.status
      : Number(originalError.status)
    // storage-js treats a local Storage 400/404 response as a missing object.
    // Confirming the bucket separately below distinguishes that from a missing bucket.
    if (originalStatus === 400 || originalStatus === 404) return 'generic'
  }
  if (inspectNested && value.originalError !== error) {
    return missingObjectEvidence(value.originalError, false)
  }
  return null
}

function validateClaims(
  data: unknown,
  limit: number,
  operationId: string,
): CleanupClaim[] | null {
  const parsed = z.array(claimSchema).safeParse(data)
  if (!parsed.success || parsed.data.length > limit) return null

  const claimIdentities = new Set<string>()
  const objectIdentities = new Set<string>()
  for (const claim of parsed.data) {
    if (claim.operation_id !== operationId) return null
    const objectIdentity = `${claim.storage_bucket}\n${claim.storage_path}`
    const claimIdentity = `${claim.operation_id}\n${objectIdentity}`
    if (claimIdentities.has(claimIdentity) || objectIdentities.has(objectIdentity)) return null
    claimIdentities.add(claimIdentity)
    objectIdentities.add(objectIdentity)
  }
  return parsed.data
}

function distinctValidClaims(data: unknown, operationId: string): CleanupClaim[] {
  if (!Array.isArray(data)) return []
  const claims = new Map<string, CleanupClaim>()
  for (const candidate of data) {
    const parsed = claimSchema.safeParse(candidate)
    if (!parsed.success || parsed.data.operation_id !== operationId) continue
    const key = `${parsed.data.operation_id}\n${parsed.data.storage_bucket}\n${parsed.data.storage_path}`
    claims.set(key, parsed.data)
  }
  return [...claims.values()]
}

function objectRef(claim: CleanupClaim): string {
  return createHash('sha256')
    .update(`${claim.operation_id}\n${claim.storage_bucket}\n${claim.storage_path}`)
    .digest('hex')
}

async function readObject(
  supabase: SupabaseClient,
  bucketName: CleanupClaim['storage_bucket'],
  path: string,
): Promise<ObjectReadResult> {
  const bucket = supabase.storage.from(bucketName)
  try {
    const response = await bucket.download(path)
    if (response.data) {
      try {
        return {
          status: 'present',
          bytes: new Uint8Array(await response.data.arrayBuffer()),
        }
      } catch {
        return { status: 'uncertain' }
      }
    }
    const evidence = missingObjectEvidence(response.error)
    if (evidence === 'object') return { status: 'absent' }
    if (evidence === 'generic') {
      const bucketResponse = await supabase.storage.getBucket(bucketName)
      if (!bucketResponse.error && bucketResponse.data?.id === bucketName) {
        return { status: 'absent' }
      }
    }
    return { status: 'uncertain' }
  } catch (error) {
    const evidence = missingObjectEvidence(error)
    if (evidence === 'object') return { status: 'absent' }
    if (evidence === 'generic') {
      try {
        const bucketResponse = await supabase.storage.getBucket(bucketName)
        if (!bucketResponse.error && bucketResponse.data?.id === bucketName) {
          return { status: 'absent' }
        }
      } catch {
        // A missing or unreadable bucket is not evidence that the exact key was deleted.
      }
    }
    return { status: 'uncertain' }
  }
}

async function recordCleanupFailure(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  errorCode: string
}): Promise<boolean> {
  try {
    const response = await args.supabase.rpc(
      'fail_classroom_archive_source_object_cleanup',
      {
        p_operation_id: args.claim.operation_id,
        p_storage_bucket: args.claim.storage_bucket,
        p_storage_path: args.claim.storage_path,
        p_lease_token: args.leaseToken,
        p_error_code: args.errorCode,
      },
    )
    if (response.error) return false
    const parsed = booleanRpcSchema.safeParse(response.data)
    return parsed.success && parsed.data
  } catch {
    return false
  }
}

async function failedItem(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  errorCode: string
}): Promise<ClassroomArchiveSourceCleanupItemResult> {
  return {
    object_ref: objectRef(args.claim),
    attempt_count: args.claim.attempt_count,
    status: 'failed',
    error_code: args.errorCode,
    retry_recorded: await recordCleanupFailure(args),
  }
}

async function completeItem(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
}): Promise<ClassroomArchiveSourceCleanupItemResult> {
  try {
    const response = await args.supabase.rpc(
      'complete_classroom_archive_source_object_cleanup',
      {
        p_operation_id: args.claim.operation_id,
        p_storage_bucket: args.claim.storage_bucket,
        p_storage_path: args.claim.storage_path,
        p_lease_token: args.leaseToken,
      },
    )
    if (!response.error) {
      const parsed = booleanRpcSchema.safeParse(response.data)
      if (parsed.success && parsed.data) {
        return {
          object_ref: objectRef(args.claim),
          attempt_count: args.claim.attempt_count,
          status: 'deleted',
        }
      }
      if (parsed.success) {
        return {
          object_ref: objectRef(args.claim),
          attempt_count: args.claim.attempt_count,
          status: 'failed',
          error_code: 'archive_source_cleanup_completion_rejected',
          retry_recorded: false,
        }
      }
    }
  } catch {
    // Failure evidence is recorded below while the lease is still current.
  }
  return failedItem({
    ...args,
    errorCode: 'archive_source_cleanup_completion_failed',
  })
}

async function renewCleanupLease(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  leaseSeconds: number
}): Promise<boolean> {
  try {
    const response = await args.supabase.rpc(
      'renew_classroom_archive_source_object_cleanup_lease',
      {
        p_operation_id: args.claim.operation_id,
        p_storage_bucket: args.claim.storage_bucket,
        p_storage_path: args.claim.storage_path,
        p_lease_token: args.leaseToken,
        p_lease_seconds: args.leaseSeconds,
      },
    )
    if (response.error) return false
    const parsed = booleanRpcSchema.safeParse(response.data)
    return parsed.success && parsed.data
  } catch {
    return false
  }
}

async function processCleanupClaim(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  leaseSeconds: number
}): Promise<ClassroomArchiveSourceCleanupItemResult> {
  const bucket = args.supabase.storage.from(args.claim.storage_bucket)
  const beforeRemoval = await readObject(
    args.supabase,
    args.claim.storage_bucket,
    args.claim.storage_path,
  )

  if (beforeRemoval.status === 'absent') return completeItem(args)
  if (beforeRemoval.status === 'uncertain') {
    return failedItem({ ...args, errorCode: 'archive_source_object_read_failed' })
  }

  const actualSha256 = createHash('sha256').update(beforeRemoval.bytes).digest('hex')
  if (
    beforeRemoval.bytes.byteLength !== args.claim.expected_byte_size
    || actualSha256 !== args.claim.expected_sha256
  ) {
    return failedItem({ ...args, errorCode: 'archive_source_object_mismatch' })
  }

  if (!await renewCleanupLease(args)) {
    return failedItem({
      ...args,
      errorCode: 'archive_source_cleanup_lease_renewal_failed',
    })
  }

  let removeFailed = false
  try {
    const response = await bucket.remove([args.claim.storage_path])
    removeFailed = Boolean(response.error)
  } catch {
    removeFailed = true
  }

  const afterRemoval = await readObject(
    args.supabase,
    args.claim.storage_bucket,
    args.claim.storage_path,
  )
  if (afterRemoval.status === 'absent') return completeItem(args)
  if (afterRemoval.status === 'present') {
    return failedItem({
      ...args,
      errorCode: removeFailed
        ? 'archive_source_object_delete_failed'
        : 'archive_source_object_delete_unconfirmed',
    })
  }
  return failedItem({
    ...args,
    errorCode: 'archive_source_object_delete_verification_failed',
  })
}

async function processCleanupClaimSafely(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  leaseSeconds: number
}): Promise<ClassroomArchiveSourceCleanupItemResult> {
  try {
    return await processCleanupClaim(args)
  } catch {
    return failedItem({
      ...args,
      errorCode: 'archive_source_cleanup_unexpected_failure',
    })
  }
}

function emitCleanupMetric(result: ClassroomArchiveSourceCleanupResult, startedAt: number) {
  const errorCounts = result.ok
    ? result.results.reduce<Record<string, number>>((counts, item) => {
        if (item.error_code) counts[item.error_code] = (counts[item.error_code] || 0) + 1
        return counts
      }, {})
    : { [result.error_code]: 1 }
  console.info('[classroom-archive-source-cleanup-batch]', JSON.stringify({
    status: result.ok ? 'completed' : 'failed',
    duration_ms: Date.now() - startedAt,
    claimed: result.ok ? result.claimed : 0,
    deleted: result.ok ? result.deleted : 0,
    failed: result.ok ? result.failed : 0,
    retry_recording_failed: result.ok ? result.retry_recording_failed : 0,
    error_counts: errorCounts,
  }))
}

export async function runClassroomArchiveSourceCleanup(args: {
  supabase: SupabaseClient
  leaseToken: string
  operationId: string
  limit?: number
  leaseSeconds?: number
}): Promise<ClassroomArchiveSourceCleanupResult> {
  const startedAt = Date.now()
  const options = runOptionsSchema.parse({
    leaseToken: args.leaseToken,
    operationId: args.operationId,
    limit: args.limit,
    leaseSeconds: args.leaseSeconds,
  })
  const leaseToken = options.leaseToken
  const operationId = options.operationId
  const limit = options.limit ?? CLASSROOM_ARCHIVE_SOURCE_CLEANUP_MAX_CLAIMS
  const leaseSeconds = options.leaseSeconds
    ?? CLASSROOM_ARCHIVE_SOURCE_CLEANUP_DEFAULT_LEASE_SECONDS

  if (!isClassroomArchiveSourceCleanupEnabled()) {
    const result: ClassroomArchiveSourceCleanupResult = {
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'classroom_archive_source_cleanup_not_enabled',
      error: 'Classroom archive source cleanup is not enabled',
      retryable: true,
    }
    emitCleanupMetric(result, startedAt)
    return result
  }

  try {
    const response = await args.supabase.rpc(
      'claim_due_classroom_archive_source_object_cleanup',
      {
        p_lease_token: leaseToken,
        p_operation_id: operationId,
        p_limit: limit,
        p_lease_seconds: leaseSeconds,
      },
    )
    if (response.error) {
      const migrationRequired = isMissingCleanupRpc(response.error)
      const result: ClassroomArchiveSourceCleanupResult = {
        ok: false,
        status: 503,
        lease_token: leaseToken,
        error_code: migrationRequired
          ? 'classroom_archive_source_cleanup_migration_required'
          : 'archive_source_cleanup_claim_failed',
        error: migrationRequired
          ? 'Classroom archive source cleanup requires migration 086'
          : 'Classroom archive source cleanup work could not be claimed',
        retryable: true,
      }
      emitCleanupMetric(result, startedAt)
      return result
    }

    const claims = validateClaims(response.data, limit, operationId)
    if (!claims) {
      await Promise.all(distinctValidClaims(response.data, operationId).map((claim) =>
        recordCleanupFailure({
          supabase: args.supabase,
          claim,
          leaseToken,
          errorCode: 'archive_source_cleanup_claim_contract_invalid',
        })
      ))
      const result: ClassroomArchiveSourceCleanupResult = {
        ok: false,
        status: 500,
        lease_token: leaseToken,
        error_code: 'archive_source_cleanup_claim_contract_invalid',
        error: 'Classroom archive source cleanup claim returned an invalid contract',
        retryable: false,
      }
      emitCleanupMetric(result, startedAt)
      return result
    }

    const results: ClassroomArchiveSourceCleanupItemResult[] = []
    for (const claim of claims) {
      results.push(await processCleanupClaimSafely({
        supabase: args.supabase,
        claim,
        leaseToken,
        leaseSeconds,
      }))
    }
    const deleted = results.filter((item) => item.status === 'deleted').length
    const failed = results.length - deleted
    const result: ClassroomArchiveSourceCleanupResult = {
      ok: true,
      status: 200,
      lease_token: leaseToken,
      claimed: claims.length,
      deleted,
      failed,
      retry_recording_failed: results.filter(
        (item) => item.status === 'failed' && !item.retry_recorded,
      ).length,
      results,
    }
    emitCleanupMetric(result, startedAt)
    return result
  } catch {
    const result: ClassroomArchiveSourceCleanupResult = {
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'archive_source_cleanup_claim_failed',
      error: 'Classroom archive source cleanup work could not be claimed',
      retryable: true,
    }
    emitCleanupMetric(result, startedAt)
    return result
  }
}
