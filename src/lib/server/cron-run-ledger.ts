import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase'

const countSchema = z.number().int().nonnegative().safe()
const errorCodeSchema = z.string().regex(/^[a-z0-9_]{1,64}$/)

export const cleanupHistoryCronMetricsSchema = z.object({
  classroom_purge_processed: countSchema.optional(),
  classroom_purge_completed: countSchema.optional(),
  classroom_purge_failed: countSchema.optional(),
  cold_classroom_purge_processed: countSchema.optional(),
  cold_classroom_purge_completed: countSchema.optional(),
  cold_classroom_purge_failed: countSchema.optional(),
  course_blueprint_purge_processed: countSchema.optional(),
  course_blueprint_purge_completed: countSchema.optional(),
  course_blueprint_purge_failed: countSchema.optional(),
  student_purge_processed: countSchema.optional(),
  student_purge_completed: countSchema.optional(),
  student_purge_failed: countSchema.optional(),
  student_health_active: countSchema.optional(),
  student_health_stuck: countSchema.optional(),
  student_health_failed: countSchema.optional(),
  student_health_orphan_fences: countSchema.optional(),
  student_health_processing_lease_drift: countSchema.optional(),
  archive_staging_cleaned: countSchema.optional(),
  archive_objects_claimed: countSchema.optional(),
  archive_objects_deleted: countSchema.optional(),
  archive_objects_failed: countSchema.optional(),
  save_operations_deleted: countSchema.optional(),
  expired_classrooms_scanned: countSchema.optional(),
  assignment_history_deleted: countSchema.optional(),
  test_history_deleted: countSchema.optional(),
  history_rows_deleted: countSchema.optional(),
  managed_health_healthy: z.boolean().optional(),
  managed_health_critical: countSchema.optional(),
  managed_health_warning: countSchema.optional(),
}).strict()

export type CleanupHistoryCronMetrics = z.infer<typeof cleanupHistoryCronMetricsSchema>

const invocationSchema = z.object({
  invocationSource: z.enum(['vercel_cron', 'manual']),
  schedule: z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/).nullable(),
  deploymentId: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).nullable(),
}).strict().superRefine((value, context) => {
  if ((value.invocationSource === 'vercel_cron') !== (value.schedule !== null)) {
    context.addIssue({
      code: 'custom',
      message: 'Vercel cron invocations require a schedule',
      path: ['schedule'],
    })
  }
})

export type CleanupHistoryInvocation = z.infer<typeof invocationSchema>

const beginResultSchema = z.object({
  run_id: z.string().uuid(),
  started: z.boolean(),
}).strict()

const runEvidenceSchema = z.object({
  schedule: z.string().nullable(),
  status: z.enum(['running', 'succeeded', 'failed', 'skipped_overlap']),
  started_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  http_status: z.number().int().min(200).max(599).nullable(),
  error_code: errorCodeSchema.nullable(),
  metrics: cleanupHistoryCronMetricsSchema,
}).strict()

const completedRunSchema = runEvidenceSchema.extend({
  invocation_source: z.enum(['vercel_cron', 'manual']),
})

export const cleanupHistoryCronHealthSchema = z.object({
  version: z.literal(1),
  captured_at: z.string().datetime({ offset: true }),
  healthy: z.boolean(),
  stale_running_count: countSchema,
  failed_count_7d: countSchema,
  overlap_count_7d: countSchema,
  latest_run: completedRunSchema.nullable(),
  latest_vercel_run: runEvidenceSchema.nullable(),
}).strict()

export type CleanupHistoryCronHealth = z.infer<typeof cleanupHistoryCronHealthSchema>

type RpcError = { code?: string; message?: string }
type LedgerClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{
    data: unknown
    error: RpcError | null
  }>
}

export type CleanupHistoryCronRun =
  | { schemaAvailable: false }
  | { schemaAvailable: true; runId: string; started: boolean }

export class CronRunLedgerError extends Error {
  constructor(public readonly code: string) {
    super('Cron run ledger could not be updated')
    this.name = 'CronRunLedgerError'
  }
}

function ledgerClient(value: ReturnType<typeof getServiceRoleClient>): LedgerClient {
  return value as unknown as LedgerClient
}

function isMissingSchemaError(error: RpcError): boolean {
  return error.code === 'PGRST202'
}

function optionalTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function resolveCleanupHistoryInvocation(
  headers: Headers,
  deploymentId: string | undefined = process.env.VERCEL_DEPLOYMENT_ID,
): CleanupHistoryInvocation {
  const schedule = optionalTrimmed(headers.get('x-vercel-cron-schedule'))
  const parsed = invocationSchema.safeParse({
    invocationSource: schedule === null ? 'manual' : 'vercel_cron',
    schedule,
    deploymentId: optionalTrimmed(deploymentId),
  })
  if (!parsed.success) throw new CronRunLedgerError('cron_run_invocation_invalid')
  return parsed.data
}

export async function beginCleanupHistoryCronRun(input: {
  supabase?: ReturnType<typeof getServiceRoleClient>
  invocation: CleanupHistoryInvocation
}): Promise<CleanupHistoryCronRun> {
  const invocation = invocationSchema.safeParse(input.invocation)
  if (!invocation.success) throw new CronRunLedgerError('cron_run_invocation_invalid')

  const supabase = input.supabase ?? getServiceRoleClient()
  const { data, error } = await ledgerClient(supabase).rpc(
    'begin_cleanup_history_cron_run',
    {
      p_invocation_source: invocation.data.invocationSource,
      p_schedule: invocation.data.schedule,
      p_deployment_id: invocation.data.deploymentId,
    },
  )

  if (error) {
    if (isMissingSchemaError(error)) {
      console.warn('[cron-run-ledger] schema unavailable', {
        error_code: error.code ?? 'unknown',
      })
      return { schemaAvailable: false }
    }
    throw new CronRunLedgerError('cron_run_begin_failed')
  }

  const parsed = beginResultSchema.safeParse(data)
  if (!parsed.success) throw new CronRunLedgerError('cron_run_begin_contract_invalid')
  return {
    schemaAvailable: true,
    runId: parsed.data.run_id,
    started: parsed.data.started,
  }
}

export async function finishCleanupHistoryCronRun(input: {
  supabase?: ReturnType<typeof getServiceRoleClient>
  run: CleanupHistoryCronRun
  status: 'succeeded' | 'failed'
  httpStatus: number
  errorCode: string | null
  metrics: CleanupHistoryCronMetrics
}): Promise<void> {
  if (!input.run.schemaAvailable || !input.run.started) return

  const metrics = cleanupHistoryCronMetricsSchema.safeParse(input.metrics)
  if (!metrics.success) throw new CronRunLedgerError('cron_run_metrics_invalid')
  const errorCode = input.errorCode === null
    ? { success: true as const, data: null }
    : errorCodeSchema.safeParse(input.errorCode)
  const validOutcome = Number.isSafeInteger(input.httpStatus)
    && input.httpStatus >= 200
    && input.httpStatus <= 599
    && errorCode.success
    && (
      (input.status === 'succeeded' && input.httpStatus < 300 && errorCode.data === null)
      || (input.status === 'failed' && input.httpStatus >= 400 && errorCode.data !== null)
    )
  if (!validOutcome) throw new CronRunLedgerError('cron_run_outcome_invalid')

  const supabase = input.supabase ?? getServiceRoleClient()
  const { data, error } = await ledgerClient(supabase).rpc(
    'finish_cleanup_history_cron_run',
    {
      p_run_id: input.run.runId,
      p_status: input.status,
      p_http_status: input.httpStatus,
      p_error_code: errorCode.data,
      p_metrics: metrics.data,
    },
  )
  if (error || data !== true) {
    throw new CronRunLedgerError('cron_run_finish_failed')
  }
}

export async function readCleanupHistoryCronHealth(input: {
  supabase?: ReturnType<typeof getServiceRoleClient>
  staleMinutes?: number
} = {}): Promise<
  | { schemaAvailable: false }
  | { schemaAvailable: true; snapshot: CleanupHistoryCronHealth }
> {
  const staleMinutes = input.staleMinutes ?? 120
  if (!Number.isSafeInteger(staleMinutes) || staleMinutes < 5 || staleMinutes > 10_080) {
    throw new CronRunLedgerError('cron_run_health_threshold_invalid')
  }

  const supabase = input.supabase ?? getServiceRoleClient()
  const { data, error } = await ledgerClient(supabase).rpc(
    'get_cleanup_history_cron_health_snapshot',
    { p_stale_minutes: staleMinutes },
  )
  if (error) {
    if (isMissingSchemaError(error)) return { schemaAvailable: false }
    throw new CronRunLedgerError('cron_run_health_query_failed')
  }
  const parsed = cleanupHistoryCronHealthSchema.safeParse(data)
  if (!parsed.success) throw new CronRunLedgerError('cron_run_health_contract_invalid')
  return { schemaAvailable: true, snapshot: parsed.data }
}
