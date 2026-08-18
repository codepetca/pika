import { formatDateInToronto } from '@/lib/timezone'
import {
  buildDailyLogWeekConfiguredEvent,
  palPeriodKeyForActivityDay,
} from '@/lib/server/pal-events'
import { isPalEnabled } from '@/lib/server/pal-config'
import {
  palTermCalendarForPeriodStart,
  type PalTermCalendar,
} from '@/lib/server/pal-term-calendar'
import { getServiceRoleClient } from '@/lib/supabase'
import { chunkValues, loadPagedRows } from '@/lib/server/query-chunks'

type PalWeeklyClient = ReturnType<typeof getServiceRoleClient>

export type PalEnrollmentSchedule = {
  studentId: string
  classroomId: string
  enrolledAt: string
  classroomStart: string | null
  classroomEnd: string | null
  archivedAt: string | null
}

export type PalClassDay = {
  classroomId: string
  date: string
}

export type PalWeeklyConfiguration = {
  studentId: string
  periodKey: string
  configVersion: number
  periodStatus: 'open' | 'closed'
  eligibleDays: number
  hasTermCalendar?: boolean
}

export type PalDailyLogCompletion = {
  studentId: string
  activityDay: string
}

export type PalWeeklyConfigurationRevision = PalWeeklyConfiguration & {
  termCalendar?: PalTermCalendar
}

const PAGE_SIZE = 500
export const MAX_PAL_WEEKLY_CATCH_UP_PERIODS = 12

function addCalendarDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

export function palWeeklyCatchUpPeriodStarts(input: {
  oldestOpenPeriodStart: string | null
  currentPeriodStart: string
  maxPeriods?: number
}): { periods: string[]; remaining: boolean } {
  if (
    !input.oldestOpenPeriodStart
    || input.oldestOpenPeriodStart >= input.currentPeriodStart
  ) {
    return { periods: [], remaining: false }
  }

  const maxPeriods = input.maxPeriods ?? MAX_PAL_WEEKLY_CATCH_UP_PERIODS
  const periods: string[] = []
  let period = input.oldestOpenPeriodStart
  while (period < input.currentPeriodStart && periods.length < maxPeriods) {
    periods.push(period)
    period = addCalendarDays(period, 7)
  }
  return { periods, remaining: period < input.currentPeriodStart }
}

function activityDayForTimestamp(value: string): string | null {
  const instant = new Date(value)
  return Number.isNaN(instant.getTime()) ? null : formatDateInToronto(instant)
}

function scheduleOverlapsPeriod(
  schedule: PalEnrollmentSchedule,
  periodStart: string,
  periodEnd: string,
): boolean {
  const enrollmentDay = activityDayForTimestamp(schedule.enrolledAt)
  const archiveDay = schedule.archivedAt
    ? activityDayForTimestamp(schedule.archivedAt)
    : null
  const firstDay = [periodStart, schedule.classroomStart, enrollmentDay]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? periodStart
  const lastCandidates = [periodEnd, schedule.classroomEnd]
    .filter((value): value is string => Boolean(value))
  if (archiveDay) {
    lastCandidates.push(addCalendarDays(archiveDay, -1))
  }
  const lastDay = lastCandidates.sort().at(0) ?? periodEnd
  return firstDay <= lastDay
}

function isEligibleForSchedule(
  schedule: PalEnrollmentSchedule,
  date: string,
): boolean {
  const enrollmentDay = activityDayForTimestamp(schedule.enrolledAt)
  const archiveDay = schedule.archivedAt
    ? activityDayForTimestamp(schedule.archivedAt)
    : null

  return (
    (!enrollmentDay || date >= enrollmentDay)
    && (!schedule.classroomStart || date >= schedule.classroomStart)
    && (!schedule.classroomEnd || date <= schedule.classroomEnd)
    && (!archiveDay || date < archiveDay)
  )
}

export function planPalWeeklyConfigurationRevisions(input: {
  periodStart: string
  periodStatus: 'open' | 'closed'
  createIfMissing: boolean
  schedules: PalEnrollmentSchedule[]
  classDays: PalClassDay[]
  existing: PalWeeklyConfiguration[]
  completions: PalDailyLogCompletion[]
  termCalendar?: PalTermCalendar
  allowTermCalendarUpgrade?: boolean
}): PalWeeklyConfigurationRevision[] {
  const periodKey = palPeriodKeyForActivityDay(input.periodStart)
  const periodEnd = addCalendarDays(input.periodStart, 4)
  const existingByStudent = new Map<string, PalWeeklyConfiguration>()
  for (const configuration of input.existing) {
    const previous = existingByStudent.get(configuration.studentId)
    if (!previous || configuration.configVersion > previous.configVersion) {
      existingByStudent.set(configuration.studentId, configuration)
    }
  }

  const schedulesByStudent = new Map<string, PalEnrollmentSchedule[]>()
  for (const schedule of input.schedules) {
    if (!scheduleOverlapsPeriod(schedule, input.periodStart, periodEnd)) continue
    const schedules = schedulesByStudent.get(schedule.studentId) ?? []
    schedules.push(schedule)
    schedulesByStudent.set(schedule.studentId, schedules)
  }

  const classDaysByClassroom = new Map<string, Set<string>>()
  for (const classDay of input.classDays) {
    if (classDay.date < input.periodStart || classDay.date > periodEnd) continue
    const dates = classDaysByClassroom.get(classDay.classroomId) ?? new Set<string>()
    dates.add(classDay.date)
    classDaysByClassroom.set(classDay.classroomId, dates)
  }

  const completionDaysByStudent = new Map<string, Set<string>>()
  for (const completion of input.completions) {
    const dates = completionDaysByStudent.get(completion.studentId) ?? new Set<string>()
    dates.add(completion.activityDay)
    completionDaysByStudent.set(completion.studentId, dates)
  }

  const studentIds = new Set([
    ...existingByStudent.keys(),
    ...schedulesByStudent.keys(),
  ])
  const revisions: PalWeeklyConfigurationRevision[] = []

  for (const studentId of [...studentIds].sort()) {
    const previous = existingByStudent.get(studentId)
    if (previous?.periodStatus === 'closed') continue
    if (!previous && !input.createIfMissing) continue

    const eligibleDates = new Set<string>()
    for (const schedule of schedulesByStudent.get(studentId) ?? []) {
      for (const date of classDaysByClassroom.get(schedule.classroomId) ?? []) {
        if (isEligibleForSchedule(schedule, date)) eligibleDates.add(date)
      }
    }

    const completionFloor = completionDaysByStudent.get(studentId)?.size ?? 0
    const eligibleDays = Math.max(eligibleDates.size, completionFloor)
    if (eligibleDays > 5) {
      throw new Error('Pal v1 weekly configuration cannot exceed five eligible days')
    }

    const termCalendar = input.termCalendar && (
      !previous
      || previous.hasTermCalendar
      || input.allowTermCalendarUpgrade
    )
      ? input.termCalendar
      : undefined
    const needsTermCalendarUpgrade = Boolean(
      termCalendar && previous && !previous.hasTermCalendar,
    )

    if (
      previous
      && previous.eligibleDays === eligibleDays
      && previous.periodStatus === input.periodStatus
      && !needsTermCalendarUpgrade
    ) {
      continue
    }

    revisions.push({
      studentId,
      periodKey,
      configVersion: (previous?.configVersion ?? 0) + 1,
      periodStatus: input.periodStatus,
      eligibleDays,
      ...(termCalendar ? { termCalendar } : {}),
    })
  }

  return revisions
}

type EnrollmentRow = {
  student_id: string
  classroom_id: string
  created_at: string
  classrooms:
    | {
      start_date: string | null
      end_date: string | null
      archived_at: string | null
    }
    | Array<{
      start_date: string | null
      end_date: string | null
      archived_at: string | null
    }>
}

type ClassDayRow = {
  classroom_id: string
  date: string
  is_class_day: boolean
}

type ConfigurationRow = {
  student_id: string
  period_key: string
  config_version: number
  period_status: 'open' | 'closed'
  eligible_days: number
}

type PeriodOutboxRow = {
  student_id: string
  event_type: 'daily_log.completed' | 'daily_log_week.configured'
  payload: { metadata?: Record<string, unknown> }
}

function hasAdaptiveTermCalendar(metadata: Record<string, unknown> | undefined): boolean {
  return Boolean(
    metadata
    && typeof metadata.term_token === 'string'
    && typeof metadata.term_start_day === 'string'
    && typeof metadata.term_end_day === 'string'
    && typeof metadata.term_timezone === 'string'
    && Number.isInteger(metadata.term_week_count)
    && typeof metadata.week_start_day === 'string'
    && Number.isInteger(metadata.week_index),
  )
}

async function loadPeriodInputs(
  supabase: PalWeeklyClient,
  periodStart: string,
): Promise<{
  schedules: PalEnrollmentSchedule[]
  classDays: PalClassDay[]
  existing: PalWeeklyConfiguration[]
  completions: PalDailyLogCompletion[]
}> {
  const periodKey = palPeriodKeyForActivityDay(periodStart)
  const periodEnd = addCalendarDays(periodStart, 4)

  const [
    enrollmentResult,
    configurationResult,
    periodOutboxResult,
  ] = await Promise.all([
    loadPagedRows<EnrollmentRow>(() =>
      supabase
        .from('classroom_enrollments')
        .select(
          'id, student_id, classroom_id, created_at, classrooms!inner(start_date,end_date,archived_at)',
        ),
    PAGE_SIZE),
    loadPagedRows<ConfigurationRow>(() =>
      supabase
        .from('pal_daily_log_week_configurations')
        .select('id, student_id, period_key, config_version, period_status, eligible_days')
        .eq('period_key', periodKey),
    PAGE_SIZE),
    loadPagedRows<PeriodOutboxRow>(() =>
      supabase
        .from('pal_event_outbox')
        .select('id, student_id, event_type, payload')
        .in('event_type', ['daily_log.completed', 'daily_log_week.configured'])
        .contains('payload', { metadata: { period_key: periodKey } }),
    PAGE_SIZE),
  ])

  const firstError = enrollmentResult.error
    ?? configurationResult.error
    ?? periodOutboxResult.error
  if (firstError) {
    throw new Error(`Failed to load Pal weekly configuration inputs: ${firstError.message}`)
  }

  const schedules = enrollmentResult.rows.flatMap((row) => {
    const classroom = Array.isArray(row.classrooms)
      ? row.classrooms[0]
      : row.classrooms
    if (!classroom) return []
    return [{
      studentId: row.student_id,
      classroomId: row.classroom_id,
      enrolledAt: row.created_at,
      classroomStart: classroom.start_date,
      classroomEnd: classroom.end_date,
      archivedAt: classroom.archived_at,
    }]
  })

  const classroomIds = [...new Set(schedules.map((schedule) => schedule.classroomId))]
  const classDayRows: ClassDayRow[] = []
  for (const classroomIdChunk of chunkValues(classroomIds, 50)) {
    const classDayResult = await loadPagedRows<ClassDayRow>(() =>
      supabase
        .from('class_days')
        .select('id, classroom_id, date, is_class_day')
        .in('classroom_id', classroomIdChunk)
        .gte('date', periodStart)
        .lte('date', periodEnd)
        .eq('is_class_day', true),
    PAGE_SIZE)
    if (classDayResult.error) {
      throw new Error(`Failed to load Pal class days: ${classDayResult.error.message}`)
    }
    classDayRows.push(...classDayResult.rows)
  }

  const calendarConfigurations = new Set(
    periodOutboxResult.rows.flatMap((row) => {
      const metadata = row.payload?.metadata
      return row.event_type === 'daily_log_week.configured'
        && hasAdaptiveTermCalendar(metadata)
        && Number.isInteger(metadata?.config_version)
        ? [`${row.student_id}:${String(metadata?.config_version)}`]
        : []
    }),
  )

  return {
    schedules,
    classDays: classDayRows
      .map((row) => ({ classroomId: row.classroom_id, date: row.date })),
    existing: configurationResult.rows.map((row) => ({
      studentId: row.student_id,
      periodKey: row.period_key,
      configVersion: row.config_version,
      periodStatus: row.period_status,
      eligibleDays: row.eligible_days,
      hasTermCalendar: calendarConfigurations.has(
        `${row.student_id}:${row.config_version}`,
      ),
    })),
    completions: periodOutboxResult.rows.flatMap((row) => {
      const activityDay = row.payload?.metadata?.activity_day
      return row.event_type === 'daily_log.completed' && typeof activityDay === 'string'
        ? [{ studentId: row.student_id, activityDay }]
        : []
    }),
  }
}

async function syncPeriod(input: {
  supabase: PalWeeklyClient
  periodStart: string
  periodStatus: 'open' | 'closed'
  createIfMissing: boolean
  configuredAt: Date
  termCalendar?: PalTermCalendar
  allowTermCalendarUpgrade?: boolean
}): Promise<number> {
  const periodInputs = await loadPeriodInputs(input.supabase, input.periodStart)
  const revisions = planPalWeeklyConfigurationRevisions({
    periodStart: input.periodStart,
    periodStatus: input.periodStatus,
    createIfMissing: input.createIfMissing,
    ...periodInputs,
    termCalendar: input.termCalendar,
    allowTermCalendarUpgrade: input.allowTermCalendarUpgrade,
  })

  for (const revision of revisions) {
    const event = buildDailyLogWeekConfiguredEvent({
      learnerId: revision.studentId,
      occurredAt: input.configuredAt,
      periodKey: revision.periodKey,
      configVersion: revision.configVersion,
      periodStatus: revision.periodStatus,
      eligibleDays: revision.eligibleDays,
      termCalendar: revision.termCalendar,
    })
    const { error } = await input.supabase.rpc(
      'record_pal_daily_log_week_configuration_atomic',
      {
        p_student_id: revision.studentId,
        p_period_key: revision.periodKey,
        p_config_version: revision.configVersion,
        p_period_status: revision.periodStatus,
        p_eligible_days: revision.eligibleDays,
        p_configured_at: input.configuredAt.toISOString(),
        p_pal_event: event,
      },
    )
    if (error) {
      throw new Error(`Failed to record Pal weekly configuration: ${error.message}`)
    }
  }

  return revisions.length
}

export async function syncPalWeeklyConfigurations(input: {
  supabase?: PalWeeklyClient
  now?: Date
} = {}): Promise<{
  status: 'disabled' | 'ok'
  configured: number
  closed: number
  catchUpPeriods: number
  remainingCatchUp: boolean
}> {
  if (!isPalEnabled()) {
    return {
      status: 'disabled',
      configured: 0,
      closed: 0,
      catchUpPeriods: 0,
      remainingCatchUp: false,
    }
  }

  const supabase = input.supabase ?? getServiceRoleClient()
  const now = input.now ?? new Date()
  const activityDay = formatDateInToronto(now)
  const currentPeriodStart = palPeriodKeyForActivityDay(activityDay)
    .replace(/^pika-week-/, '')
  const currentPeriodKey = palPeriodKeyForActivityDay(currentPeriodStart)
  const { data: oldestOpenRows, error: oldestOpenError } = await supabase
    .from('pal_daily_log_week_configurations')
    .select('period_key')
    .eq('period_status', 'open')
    .lt('period_key', currentPeriodKey)
    .order('period_key', { ascending: true })
    .limit(1)
  if (oldestOpenError) {
    throw new Error(`Failed to find Pal weekly catch-up boundary: ${oldestOpenError.message}`)
  }
  const oldestPeriodKey = oldestOpenRows?.[0]?.period_key
  const oldestOpenPeriodStart = typeof oldestPeriodKey === 'string'
    && oldestPeriodKey.startsWith('pika-week-')
    ? oldestPeriodKey.replace(/^pika-week-/, '')
    : null
  const catchUp = palWeeklyCatchUpPeriodStarts({
    oldestOpenPeriodStart,
    currentPeriodStart,
  })

  let closed = 0
  for (const periodStart of catchUp.periods) {
    closed += await syncPeriod({
      supabase,
      periodStart,
      periodStatus: 'closed',
      createIfMissing: false,
      configuredAt: now,
      termCalendar: palTermCalendarForPeriodStart(periodStart),
      allowTermCalendarUpgrade: false,
    })
  }
  const configured = await syncPeriod({
    supabase,
    periodStart: currentPeriodStart,
    periodStatus: 'open',
    createIfMissing: true,
    configuredAt: now,
    termCalendar: palTermCalendarForPeriodStart(currentPeriodStart),
    allowTermCalendarUpgrade: true,
  })

  return {
    status: 'ok',
    configured,
    closed,
    catchUpPeriods: catchUp.periods.length,
    remainingCatchUp: catchUp.remaining,
  }
}
