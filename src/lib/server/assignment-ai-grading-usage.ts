import { z } from 'zod'
import { ApiError } from '@/lib/api-handler'
import { AssignmentAiGradingLeaseLostError } from '@/lib/server/assignment-ai-grading-lease'
import type { getServiceRoleClient } from '@/lib/supabase'
import type { AssignmentAiGradingRun } from '@/types'

type Supabase = ReturnType<typeof getServiceRoleClient>
type ItemLease = { supabase: Supabase; itemId: string; leaseToken: string }
export type AssignmentAiUsageFailureReason = 'stale' | 'provider_failed' | 'internal_failure'

export class AssignmentAiUsageError extends ApiError {
  constructor(readonly releaseReason: AssignmentAiUsageFailureReason, status = 503) {
    super(status, status === 429 ? 'AI grading limit reached' : 'AI grading is temporarily unavailable')
  }
}

export function getAssignmentAiUsageFailureReason(error: unknown): AssignmentAiUsageFailureReason {
  return error instanceof AssignmentAiUsageError ? error.releaseReason : 'internal_failure'
}

export function isAssignmentAiGradingUsageMeteringEnabled(): boolean {
  return process.env.ASSIGNMENT_AI_GRADING_USAGE_METERING_ENABLED === 'true'
}

// Never return database messages, entitlement revisions, or reservation metadata.
export function throwAssignmentAiUsageError(error?: { code?: string; message?: string } | null): never {
  if (error?.code === '40001' && error.message === 'Assignment AI grading lease was lost') {
    throw new AssignmentAiGradingLeaseLostError()
  }
  if (error?.code === '23514' && error.message === 'feature_usage_quota_exhausted') {
    throw new AssignmentAiUsageError('internal_failure', 429)
  }
  const stale = (error?.code === '40001' && [
    'metered_assignment_source_changed', 'metered_assignment_enrollment_changed',
    'metered_assignment_binding_changed',
  ].includes(error.message ?? ''))
    || (error?.code === '55000' && error.message === 'metered_assignment_archived')
  throw new AssignmentAiUsageError(stale ? 'stale' : 'internal_failure')
}

const reservationSchema = z.object({
  reservation: z.object({
    operation_id: z.string(),
    subject_user_id: z.string(),
    feature_key: z.literal('grading.ai'),
    operation_kind: z.literal('assignment_ai_grading'),
    usage_ref: z.string(),
    units: z.literal(1),
    status: z.literal('reserved'),
    expires_at: z.string().datetime({ offset: true }),
  }),
})

export async function reserveAssignmentAiGradingItemUsage(opts: ItemLease & { teacherId: string }): Promise<void> {
  const { data, error } = await opts.supabase.rpc('reserve_assignment_ai_grading_item_usage_with_lease_v1', {
    p_item_id: opts.itemId,
    p_lease_token: opts.leaseToken,
  })
  if (error) throwAssignmentAiUsageError(error)
  const parsed = reservationSchema.safeParse(data)
  if (!parsed.success
    || parsed.data.reservation.operation_id !== opts.itemId
    || parsed.data.reservation.subject_user_id !== opts.teacherId
    || parsed.data.reservation.usage_ref !== `assignment-ai-item-v1:${opts.itemId}`
    || Date.parse(parsed.data.reservation.expires_at) <= Date.now()) {
    throwAssignmentAiUsageError()
  }
}

export async function skipAssignmentAiGradingItemUsage(opts: ItemLease & {
  attemptCount: number
  skipReason: 'missing_doc' | 'empty_doc'
}): Promise<void> {
  const { data, error } = await opts.supabase.rpc('skip_assignment_ai_grading_item_and_release_usage_v1', {
    p_item_id: opts.itemId,
    p_lease_token: opts.leaseToken,
    p_attempt_count: opts.attemptCount,
    p_skip_reason: opts.skipReason,
  })
  if (error || !data || data.id !== opts.itemId || data.status !== 'skipped') throwAssignmentAiUsageError(error)
}

export async function failAssignmentAiGradingItemUsage(opts: ItemLease & {
  attemptCount: number
  releaseReason: AssignmentAiUsageFailureReason
}): Promise<void> {
  const { data, error } = await opts.supabase.rpc('fail_assignment_ai_grading_item_and_release_usage_with_lease_v1', {
    p_item_id: opts.itemId,
    p_lease_token: opts.leaseToken,
    p_attempt_count: opts.attemptCount,
    p_error_code: 'grading_failed',
    p_error_message: 'AI grading failed',
    p_release_reason: opts.releaseReason,
  })
  if (error || !data || data.id !== opts.itemId || data.status !== 'failed') throwAssignmentAiUsageError(error)
}

export async function failAssignmentAiGradingRunUsage(opts: {
  supabase: Supabase; runId: string; leaseToken: string; releaseReason: AssignmentAiUsageFailureReason
}): Promise<AssignmentAiGradingRun> {
  const { data, error } = await opts.supabase.rpc('fail_assignment_ai_grading_run_and_release_usage_with_lease_v1', {
    p_run_id: opts.runId,
    p_lease_token: opts.leaseToken,
    p_error_code: 'run_failed',
    p_error_message: 'AI grading failed',
    p_release_reason: opts.releaseReason,
  })
  if (error || !data || data.id !== opts.runId || data.status !== 'failed') throwAssignmentAiUsageError(error)
  return data as unknown as AssignmentAiGradingRun
}
