import { z } from 'zod'

import { getServiceRoleClient } from '@/lib/supabase'
import {
  getBaraSessionSnapshot,
  type ClientOptions,
} from '@/lib/server/bara-attendance-client'

export interface AttendanceReconciliationRpcClient {
  rpc(
    name: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{
    data: unknown
    error: { code?: string; message?: string } | null
  }>
}

interface ReconciliationOptions extends ClientOptions {
  supabase?: AttendanceReconciliationRpcClient
  installationRef?: string
}

export interface BaraAttendanceReconciliationResult {
  occurrenceRef: string
  sessionProjectionApplied: boolean
  recordProjectionCount: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function reconcileBaraAttendanceSession(
  occurrenceRef: string,
  options: ReconciliationOptions = {},
): Promise<BaraAttendanceReconciliationResult> {
  const installationRef = options.installationRef
    ?? process.env.BARA_ATTENDANCE_INSTALLATION_REF?.trim()
    ?? ''
  if (!/^[A-Za-z0-9._~-]{1,128}$/.test(installationRef)) {
    throw new Error('Attendance reconciliation is not configured')
  }

  const snapshot = await getBaraSessionSnapshot(occurrenceRef, {
    fetcher: options.fetcher,
    now: options.now,
    nonce: options.nonce,
  })
  const client = options.supabase
    ?? getServiceRoleClient() as unknown as AttendanceReconciliationRpcClient
  const { data, error } = await client.rpc('apply_attendance_session_snapshot_v1', {
    p_installation_ref: installationRef,
    p_snapshot: snapshot,
  })
  if (error) throw new Error('Attendance reconciliation could not be persisted')
  if (
    !isPlainObject(data) ||
    data.applied !== true ||
    typeof data.session_projection_applied !== 'boolean' ||
    !Number.isInteger(data.record_projection_count) ||
    (data.record_projection_count as number) < 0 ||
    Object.keys(data).some((key) =>
      !['applied', 'session_projection_applied', 'record_projection_count'].includes(key),
    )
  ) {
    throw new Error('Attendance reconciliation returned an invalid result')
  }

  return {
    occurrenceRef: snapshot.occurrence_ref,
    sessionProjectionApplied: data.session_projection_applied,
    recordProjectionCount: data.record_projection_count as number,
  }
}

const DEFAULT_RECONCILIATION_LIMIT = 50
const DEFAULT_LOOKBACK_HOURS = 48
const DEFAULT_CONCURRENCY = 5

const reconciliationTargetSchema = z.object({
  occurrence_ref: z.string().regex(/^[A-Za-z0-9._~-]{1,128}$/),
}).strict()
const reconciliationTargetsSchema = z.array(reconciliationTargetSchema)
  .max(DEFAULT_RECONCILIATION_LIMIT + 1)

export interface BaraAttendanceReconciliationSummary {
  status: 'disabled' | 'ok' | 'partial'
  eligible: number
  attempted: number
  reconciled: number
  failed: number
  truncated: boolean
}

export async function reconcileBaraAttendanceSessions(input: {
  supabase: AttendanceReconciliationRpcClient
  enabled: boolean
  now?: Date
  lookbackHours?: number
  targetLimit?: number
  concurrency?: number
  reconcile?: (
    occurrenceRef: string,
    options?: ReconciliationOptions,
  ) => Promise<unknown>
}): Promise<BaraAttendanceReconciliationSummary> {
  if (!input.enabled) {
    return {
      status: 'disabled',
      eligible: 0,
      attempted: 0,
      reconciled: 0,
      failed: 0,
      truncated: false,
    }
  }

  const targetLimit = Math.min(
    DEFAULT_RECONCILIATION_LIMIT,
    Math.max(1, input.targetLimit ?? DEFAULT_RECONCILIATION_LIMIT),
  )
  const lookbackHours = Math.min(168, Math.max(1, input.lookbackHours ?? DEFAULT_LOOKBACK_HOURS))
  const concurrency = Math.min(5, Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY))
  const { data, error } = await input.supabase.rpc(
    'list_attendance_reconciliation_targets_v1',
    {
      p_now: (input.now ?? new Date()).toISOString(),
      p_lookback_hours: lookbackHours,
      p_limit: targetLimit + 1,
    },
  )
  if (error) throw new Error('Attendance reconciliation targets could not be loaded')
  const loadedTargets = reconciliationTargetsSchema.parse(data ?? [])
  const truncated = loadedTargets.length > targetLimit
  const targets = loadedTargets.slice(0, targetLimit)
  const reconcile = input.reconcile ?? reconcileBaraAttendanceSession
  let cursor = 0
  let reconciled = 0

  async function worker() {
    while (cursor < targets.length) {
      const target = targets[cursor++]
      try {
        await reconcile(target.occurrence_ref, { supabase: input.supabase })
        reconciled += 1
      } catch {
        // Aggregate-only health deliberately excludes opaque refs and remote details.
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, targets.length) },
    () => worker(),
  ))
  const failed = targets.length - reconciled

  return {
    status: failed > 0 || truncated ? 'partial' : 'ok',
    eligible: loadedTargets.length,
    attempted: targets.length,
    reconciled,
    failed,
    truncated,
  }
}
