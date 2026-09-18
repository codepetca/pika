import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { getServiceRoleClient } from '@/lib/supabase'
import { isLiveStudentCleanupEnabled, liveStudentCleanup } from '@/lib/server/live-student-cleanup'
import type { StudentProviderScope } from '@/lib/server/student-provider-cleanup'

const claimSchema = z.object({
  job_id: z.string().uuid(),
  operation_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
  classroom_id: z.string().uuid(),
  student_id: z.string().uuid(),
  generation_id: z.string().uuid(),
  attempt_count: z.number().int().positive(),
}).strict()

type QueueClient = Pick<ReturnType<typeof getServiceRoleClient>, 'rpc'>
type CleanupResult = { cleanup_completed: boolean }
type Cleanup = {
  reserve(scope: StudentProviderScope): Promise<CleanupResult>
  advance(scope: StudentProviderScope): Promise<CleanupResult>
}

export const AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_CLAIMS = 3
export const AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_ADVANCES = 10
export const AUTOMATIC_REMOVED_STUDENT_CLEANUP_TIME_BUDGET_MS = 45_000
export const AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_ATTEMPTS = 288

export function isAutomaticRemovedStudentCleanupEnabled() {
  return process.env.PIKA_AUTOMATIC_REMOVED_STUDENT_CLEANUP_ENABLED === 'true'
    && isLiveStudentCleanupEnabled()
}

async function claim(client: QueueClient, leaseToken: string) {
  const response = await client.rpc('claim_removed_student_cleanup_job', { p_lease_token: leaseToken })
  if (response.error) throw new Error('automatic_cleanup_claim_failed')
  if (response.data === null) return null
  const parsed = claimSchema.safeParse(response.data)
  if (!parsed.success) throw new Error('automatic_cleanup_claim_contract_invalid')
  return parsed.data
}

async function release(client: QueueClient, input: {
  jobId: string
  leaseToken: string
  completed: boolean
  errorCode?: string
}) {
  const response = await client.rpc('release_removed_student_cleanup_job', {
    p_job_id: input.jobId,
    p_lease_token: input.leaseToken,
    p_completed: input.completed,
    p_error_code: input.errorCode,
    // Record retry readiness promptly; the hourly watchdog controls recovery cadence.
    p_retry_delay_seconds: 240,
  })
  return response.error === null && response.data === true
}

function isTerminalCleanupError(error: unknown) {
  return error instanceof ApiError && error.statusCode === 409
}

export async function runAutomaticRemovedStudentCleanup(input: {
  client?: QueueClient
  cleanup?: Cleanup
  maxClaims?: number
  maxAdvances?: number
  maxAttempts?: number
  timeBudgetMs?: number
  now?: () => number
  leaseTokenFactory?: () => string
} = {}) {
  const client = input.client ?? getServiceRoleClient()
  const cleanup = input.cleanup ?? liveStudentCleanup()
  const maxClaims = input.maxClaims ?? AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_CLAIMS
  const maxAdvances = input.maxAdvances ?? AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_ADVANCES
  const maxAttempts = input.maxAttempts ?? AUTOMATIC_REMOVED_STUDENT_CLEANUP_MAX_ATTEMPTS
  const timeBudgetMs = input.timeBudgetMs ?? AUTOMATIC_REMOVED_STUDENT_CLEANUP_TIME_BUDGET_MS
  const now = input.now ?? Date.now
  const startedAt = now()
  const leaseTokenFactory = input.leaseTokenFactory ?? randomUUID
  const metrics = { claimed: 0, completed: 0, pending: 0, failed: 0,
    quarantined: 0, retry_recording_failed: 0 }

  for (let index = 0; index < maxClaims; index += 1) {
    const leaseToken = leaseTokenFactory()
    let job
    try {
      job = await claim(client, leaseToken)
    } catch {
      return { ok: false as const, status: 503 as const,
        error_code: 'automatic_cleanup_claim_unavailable' as const, ...metrics }
    }
    if (!job) break
    metrics.claimed += 1
    const scope = { operationId: job.operation_id, teacherId: job.teacher_id,
      classroomId: job.classroom_id, studentId: job.student_id, generationId: job.generation_id }
    try {
      if (job.attempt_count >= maxAttempts)
        throw new ApiError(409, 'Automatic cleanup attempt limit reached')
      let result = await cleanup.reserve(scope)
      for (let step = 0; step < maxAdvances && !result.cleanup_completed
        && now()-startedAt<timeBudgetMs; step += 1)
        result = await cleanup.advance(scope)
      const completed = result.cleanup_completed
      const recorded = await release(client, { jobId: job.job_id, leaseToken, completed,
        ...(!completed ? { errorCode: 'cleanup_pending' } : {}) })
      if (!recorded) metrics.retry_recording_failed += 1
      else if (completed) metrics.completed += 1
      else metrics.pending += 1
    } catch (error) {
      metrics.failed += 1
      const quarantined = isTerminalCleanupError(error)
      if (!await release(client, { jobId: job.job_id, leaseToken, completed: false,
        errorCode: quarantined ? 'cleanup_quarantined' : 'cleanup_unavailable' }))
        metrics.retry_recording_failed += 1
      else if (quarantined) metrics.quarantined += 1
    }
    if (now()-startedAt>=timeBudgetMs) break
  }
  if (metrics.retry_recording_failed > 0) return { ok: false as const, status: 503 as const,
    error_code: 'automatic_cleanup_retry_evidence_unavailable' as const, ...metrics }
  if (metrics.quarantined > 0) return { ok: false as const, status: 503 as const,
    error_code: 'automatic_cleanup_job_quarantined' as const, ...metrics }
  return { ok: true as const, status: 200 as const, ...metrics }
}
