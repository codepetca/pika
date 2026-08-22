import { addDays, format, parseISO } from 'date-fns'
import { formatInTimeZone } from 'date-fns-tz'
import { z } from 'zod'

import { getBaraAttendanceCanaryScope } from '@/lib/server/bara-attendance-canary'
import {
  BaraAttendanceSyncError,
  syncTeacherAttendanceSources,
} from '@/lib/server/bara-attendance-sync'

const TIMEZONE = 'America/Toronto'
const DEFAULT_HORIZON_DAYS = 90
const DEFAULT_TARGET_LIMIT = 50
const DEFAULT_CONCURRENCY = 3

const targetSchema = z.object({
  classroom_id: z.string().uuid(),
  teacher_id: z.string().uuid(),
}).strict()

const targetListSchema = z.array(targetSchema).max(DEFAULT_TARGET_LIMIT + 1)

export class BaraAttendanceAutomationError extends Error {
  constructor(readonly code: 'migration_required' | 'target_load_failed') {
    super(code)
    this.name = 'BaraAttendanceAutomationError'
  }
}

function windowFor(now: Date, horizonDays: number) {
  const windowStart = formatInTimeZone(now, TIMEZONE, 'yyyy-MM-dd')
  return {
    windowStart,
    windowEnd: format(addDays(parseISO(windowStart), horizonDays), 'yyyy-MM-dd'),
  }
}

async function loadTargets(
  supabase: any,
  teacherId: string,
  classroomId: string,
  targetLimit: number,
) {
  const { data, error } = await supabase.rpc('list_attendance_sync_targets_v2', {
    p_teacher_id: teacherId,
    p_classroom_id: classroomId,
    p_limit: targetLimit + 1,
  })
  if (error?.code === '42883' || error?.code === 'PGRST202') {
    throw new BaraAttendanceAutomationError('migration_required')
  }
  if (error) throw new BaraAttendanceAutomationError('target_load_failed')
  const parsed = targetListSchema.safeParse(data ?? [])
  if (!parsed.success) throw new BaraAttendanceAutomationError('target_load_failed')
  if (parsed.data.some((target) =>
    target.teacher_id !== teacherId || target.classroom_id !== classroomId
  )) {
    throw new BaraAttendanceAutomationError('target_load_failed')
  }
  return parsed.data
}

type FailureReason =
  | 'identity_not_linked'
  | 'policy_missing'
  | 'source_changed'
  | 'unavailable'

export interface BaraAttendanceAutomationSummary {
  status: 'disabled' | 'ok' | 'partial'
  windowStart: string | null
  windowEnd: string | null
  eligible: number
  attempted: number
  synced: number
  failed: number
  truncated: boolean
  failures: Record<FailureReason, number>
}

function failureReason(error: unknown): FailureReason {
  if (error instanceof BaraAttendanceSyncError) {
    if (error.code === 'identity_not_linked') return 'identity_not_linked'
    if (error.code === 'policy_missing') return 'policy_missing'
    if (error.code === 'source_changed') return 'source_changed'
  }
  return 'unavailable'
}

export async function syncBaraAttendanceSchedules(input: {
  supabase: any
  now?: Date
  horizonDays?: number
  targetLimit?: number
  concurrency?: number
  integrationState?: 'disabled' | 'not_configured' | 'ready'
  teacherId?: string
  classroomId?: string
  sync?: typeof syncTeacherAttendanceSources
}): Promise<BaraAttendanceAutomationSummary> {
  const scope = getBaraAttendanceCanaryScope()
  const integrationState = input.integrationState ?? scope.state
  const teacherId = input.teacherId ?? scope.teacherId
  const classroomId = input.classroomId ?? scope.classroomId
  const failures: Record<FailureReason, number> = {
    identity_not_linked: 0,
    policy_missing: 0,
    source_changed: 0,
    unavailable: 0,
  }
  if (integrationState !== 'ready' || !teacherId || !classroomId) {
    return {
      status: 'disabled',
      windowStart: null,
      windowEnd: null,
      eligible: 0,
      attempted: 0,
      synced: 0,
      failed: 0,
      truncated: false,
      failures,
    }
  }

  const targetLimit = Math.min(DEFAULT_TARGET_LIMIT, Math.max(1, input.targetLimit ?? DEFAULT_TARGET_LIMIT))
  const horizonDays = Math.min(400, Math.max(1, input.horizonDays ?? DEFAULT_HORIZON_DAYS))
  const concurrency = Math.min(5, Math.max(1, input.concurrency ?? DEFAULT_CONCURRENCY))
  const { windowStart, windowEnd } = windowFor(input.now ?? new Date(), horizonDays)
  const loadedTargets = await loadTargets(input.supabase, teacherId, classroomId, targetLimit)
  const truncated = loadedTargets.length > targetLimit
  const targets = loadedTargets.slice(0, targetLimit)
  const sync = input.sync ?? syncTeacherAttendanceSources
  let cursor = 0
  let synced = 0

  async function worker() {
    while (cursor < targets.length) {
      const target = targets[cursor++]
      try {
        await sync({
          supabase: input.supabase,
          teacherId: target.teacher_id,
          classroomId: target.classroom_id,
          windowStart,
          windowEnd,
          integrationState: 'ready',
        })
        synced += 1
      } catch (error) {
        failures[failureReason(error)] += 1
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, targets.length) },
    () => worker(),
  ))
  const failed = targets.length - synced

  return {
    status: failed > 0 || truncated ? 'partial' : 'ok',
    windowStart,
    windowEnd,
    eligible: loadedTargets.length,
    attempted: targets.length,
    synced,
    failed,
    truncated,
    failures,
  }
}
