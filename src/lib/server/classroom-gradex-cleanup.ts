import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CLASSROOM_GRADEX_EXTRACT_BUCKET } from '@/lib/server/classroom-gradex-operations'
import { getServiceRoleClient } from '@/lib/supabase'

export const CLASSROOM_GRADEX_CLEANUP_MAX_CLAIMS = 10
export const CLASSROOM_GRADEX_CLEANUP_DEFAULT_LEASE_SECONDS = 300

const uuidSchema = z.string().uuid()
const claimSchema = z.object({
  extract_id: uuidSchema,
  storage_bucket: z.literal(CLASSROOM_GRADEX_EXTRACT_BUCKET),
  storage_path: z.string().min(1),
  attempt_count: z.number().int().positive(),
}).strict().superRefine((claim, context) => {
  const segments = claim.storage_path.split('/')
  if (
    segments.length !== 4 ||
    !uuidSchema.safeParse(segments[0]).success ||
    !uuidSchema.safeParse(segments[1]).success ||
    segments[2] !== claim.extract_id ||
    segments[3] !== 'gradex-v1.tar.gz'
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Gradex cleanup claim path does not match its extract identity',
      path: ['storage_path'],
    })
  }
})
const runOptionsSchema = z.object({
  leaseToken: uuidSchema,
  limit: z.number().int().min(1).max(CLASSROOM_GRADEX_CLEANUP_MAX_CLAIMS).optional(),
  leaseSeconds: z.number().int().min(30).max(1800).optional(),
}).strict()
const booleanRpcSchema = z.boolean()

type SupabaseClient = ReturnType<typeof getServiceRoleClient>
type CleanupClaim = z.infer<typeof claimSchema>

export type ClassroomGradexCleanupItemResult = {
  extract_id: string
  attempt_count: number
  status: 'deleted' | 'failed'
  error_code?: string
  retry_recorded?: boolean
}

export type ClassroomGradexCleanupResult =
  | {
      ok: true
      status: 200
      lease_token: string
      claimed: number
      deleted: number
      failed: number
      retry_recording_failed: number
      results: ClassroomGradexCleanupItemResult[]
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
  status?: unknown
  statusCode?: unknown
  code?: unknown
  error?: unknown
}

export function isClassroomGradexCleanupEnabled(): boolean {
  return process.env.CLASSROOM_GRADEX_CLEANUP_ENABLED?.trim().toLowerCase() === 'true'
}

export function resolveClassroomGradexCleanupLeaseToken(
  value?: string | null,
): string {
  return value ? uuidSchema.parse(value.trim()) : randomUUID()
}

function isMissingCleanupRpc(error: { code?: string; message?: string } | null | undefined) {
  if (!error) return false
  const message = (error.message || '').toLowerCase()
  return error.code === '42883' || error.code === 'PGRST202' || (
    message.includes('claim_due_classroom_gradex_extract_cleanup') ||
    message.includes('complete_classroom_gradex_extract_cleanup') ||
    message.includes('fail_classroom_gradex_extract_cleanup')
  )
}

function isAuthoritativeMissingObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as StorageErrorShape
  const codes = [value.statusCode, value.code, value.error]
    .filter((code): code is string | number => (
      typeof code === 'string' || typeof code === 'number'
    ))
    .map((code) => String(code).toLowerCase())
  if (codes.includes('nosuchkey')) return true
  const status = typeof value.status === 'number' ? value.status : Number(value.status)
  return status === 404 && codes.includes('not_found')
}

function validateClaims(data: unknown, limit: number): CleanupClaim[] | null {
  const parsed = z.array(claimSchema).safeParse(data)
  if (!parsed.success || parsed.data.length > limit) return null
  const extractIds = new Set<string>()
  const storagePaths = new Set<string>()
  for (const claim of parsed.data) {
    if (extractIds.has(claim.extract_id) || storagePaths.has(claim.storage_path)) return null
    extractIds.add(claim.extract_id)
    storagePaths.add(claim.storage_path)
  }
  return parsed.data
}

async function recordCleanupFailure(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
  errorCode: string
}): Promise<boolean> {
  try {
    const response = await args.supabase.rpc('fail_classroom_gradex_extract_cleanup', {
      p_extract_id: args.claim.extract_id,
      p_lease_token: args.leaseToken,
      p_error_code: args.errorCode,
    })
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
}): Promise<ClassroomGradexCleanupItemResult> {
  return {
    extract_id: args.claim.extract_id,
    attempt_count: args.claim.attempt_count,
    status: 'failed',
    error_code: args.errorCode,
    retry_recorded: await recordCleanupFailure(args),
  }
}

async function processCleanupClaim(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
}): Promise<ClassroomGradexCleanupItemResult> {
  const bucket = args.supabase.storage.from(CLASSROOM_GRADEX_EXTRACT_BUCKET)
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
    const verification = await bucket.download(args.claim.storage_path)
    present = Boolean(verification.data)
    absent = !verification.data && isAuthoritativeMissingObject(verification.error)
  } catch (error) {
    absent = isAuthoritativeMissingObject(error)
  }

  if (!absent) {
    return failedItem({
      ...args,
      errorCode: present
        ? removeFailed
          ? 'gradex_storage_delete_failed'
          : 'gradex_storage_delete_unconfirmed'
        : 'gradex_storage_delete_verification_failed',
    })
  }

  try {
    const response = await args.supabase.rpc('complete_classroom_gradex_extract_cleanup', {
      p_extract_id: args.claim.extract_id,
      p_lease_token: args.leaseToken,
    })
    if (!response.error) {
      const parsed = booleanRpcSchema.safeParse(response.data)
      if (parsed.success && parsed.data) {
        return {
          extract_id: args.claim.extract_id,
          attempt_count: args.claim.attempt_count,
          status: 'deleted',
        }
      }
      if (parsed.success) {
        return {
          extract_id: args.claim.extract_id,
          attempt_count: args.claim.attempt_count,
          status: 'failed',
          error_code: 'gradex_cleanup_completion_rejected',
          retry_recorded: false,
        }
      }
    }
  } catch {
    // The retry ledger is updated below when the current lease is still valid.
  }
  return failedItem({
    ...args,
    errorCode: 'gradex_cleanup_completion_failed',
  })
}

async function processCleanupClaimSafely(args: {
  supabase: SupabaseClient
  claim: CleanupClaim
  leaseToken: string
}): Promise<ClassroomGradexCleanupItemResult> {
  try {
    return await processCleanupClaim(args)
  } catch {
    return failedItem({
      ...args,
      errorCode: 'gradex_cleanup_unexpected_failure',
    })
  }
}

function emitCleanupMetric(result: ClassroomGradexCleanupResult, startedAt: number) {
  const errorCounts = result.ok
    ? result.results.reduce<Record<string, number>>((counts, item) => {
        if (item.error_code) counts[item.error_code] = (counts[item.error_code] || 0) + 1
        return counts
      }, {})
    : { [result.error_code]: 1 }
  console.info('[classroom-gradex-cleanup-batch]', JSON.stringify({
    lease_token: result.lease_token,
    status: result.ok ? 'completed' : 'failed',
    duration_ms: Date.now() - startedAt,
    claimed: result.ok ? result.claimed : 0,
    deleted: result.ok ? result.deleted : 0,
    failed: result.ok ? result.failed : 0,
    retry_recording_failed: result.ok ? result.retry_recording_failed : 0,
    error_counts: errorCounts,
  }))
}

export async function runClassroomGradexCleanup(args: {
  supabase: SupabaseClient
  leaseToken: string
  limit?: number
  leaseSeconds?: number
}): Promise<ClassroomGradexCleanupResult> {
  const startedAt = Date.now()
  const options = runOptionsSchema.parse({
    leaseToken: args.leaseToken,
    limit: args.limit,
    leaseSeconds: args.leaseSeconds,
  })
  const leaseToken = options.leaseToken
  const limit = options.limit ?? CLASSROOM_GRADEX_CLEANUP_MAX_CLAIMS
  const leaseSeconds = options.leaseSeconds ?? CLASSROOM_GRADEX_CLEANUP_DEFAULT_LEASE_SECONDS

  if (!isClassroomGradexCleanupEnabled()) {
    const result: ClassroomGradexCleanupResult = {
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'classroom_gradex_cleanup_not_enabled',
      error: 'Classroom Gradex cleanup is not enabled',
      retryable: true,
    }
    emitCleanupMetric(result, startedAt)
    return result
  }

  try {
    const response = await args.supabase.rpc('claim_due_classroom_gradex_extract_cleanup', {
      p_lease_token: leaseToken,
      p_limit: limit,
      p_lease_seconds: leaseSeconds,
    })
    if (response.error) {
      const missingMigration = isMissingCleanupRpc(response.error)
      const result: ClassroomGradexCleanupResult = {
        ok: false,
        status: 503,
        lease_token: leaseToken,
        error_code: missingMigration
          ? 'classroom_gradex_migration_required'
          : 'gradex_cleanup_claim_failed',
        error: missingMigration
          ? 'Classroom Gradex cleanup requires migration 084'
          : 'Gradex cleanup work could not be claimed',
        retryable: true,
      }
      emitCleanupMetric(result, startedAt)
      return result
    }

    const claims = validateClaims(response.data, limit)
    if (!claims) {
      const result: ClassroomGradexCleanupResult = {
        ok: false,
        status: 500,
        lease_token: leaseToken,
        error_code: 'gradex_cleanup_claim_contract_invalid',
        error: 'Gradex cleanup claim returned an invalid contract',
        retryable: false,
      }
      emitCleanupMetric(result, startedAt)
      return result
    }

    const results: ClassroomGradexCleanupItemResult[] = []
    for (const claim of claims) {
      results.push(await processCleanupClaimSafely({
        supabase: args.supabase,
        claim,
        leaseToken,
      }))
    }
    const deleted = results.filter((item) => item.status === 'deleted').length
    const failed = results.length - deleted
    const result: ClassroomGradexCleanupResult = {
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
    const result: ClassroomGradexCleanupResult = {
      ok: false,
      status: 503,
      lease_token: leaseToken,
      error_code: 'gradex_cleanup_claim_failed',
      error: 'Gradex cleanup work could not be claimed',
      retryable: true,
    }
    emitCleanupMetric(result, startedAt)
    return result
  }
}
