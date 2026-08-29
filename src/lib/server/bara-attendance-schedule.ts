import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { V1ScheduleSnapshot } from '@/vendor/attendance-contract/v1/types'
import { validateV1Message } from '@/vendor/attendance-contract/v1/validate'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface BaraAttendanceWindowPolicy {
  timezone: 'America/Toronto'
  sessionStartsAtLocal: string
  sessionEndsAtLocal: string
  sessionEndDayOffset: 0 | 1
  entryOpensMinutesBefore: number
  presentGraceMinutes: number
  entryClosesMinutesBeforeEnd: number
  absentMinutesBeforeEnd: number
  policyRevision: number
}

export interface BaraAttendanceCutoffSnapshot {
  occurrence_ref: string
  date: string
  accepts_at: string
  stops_accepting_at: string
  session_starts_at: string
  session_ends_at: string
  present_through_at: string
  absent_at: string
  policy_revision: number
}

export interface BaraAttendanceClassDay {
  date: string
  isClassDay: boolean
  occurrenceRef: string
  frozenCutoffs?: BaraAttendanceCutoffSnapshot
}

export interface BuildBaraScheduleSnapshotInput {
  installationRef: string
  rosterRef: string
  revision: number
  idempotencyKey: string
  correlationRef: string
  windowStart: string
  windowEnd: string
  attendanceTitle: string
  policy: BaraAttendanceWindowPolicy
  classDays: BaraAttendanceClassDay[]
}

export interface MaterializedBaraAttendanceSchedule {
  schedule: V1ScheduleSnapshot
  cutoffs: BaraAttendanceCutoffSnapshot[]
}

function isCalendarDate(value: string) {
  if (!DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function requireMappedRef(value: string, prefix: 'pika' | 'roster' | 'occurrence') {
  const pattern = new RegExp(`^${prefix}_[A-Za-z0-9._~-]{1,${127 - prefix.length}}$`)
  if (!pattern.test(value) || UUID.test(value)) {
    throw new Error(`Attendance scheduling requires an opaque ${prefix} reference`)
  }
}

function materializeLocalInstant(
  date: string,
  time: string,
  timezone: BaraAttendanceWindowPolicy['timezone'],
) {
  const wallTime = `${date} ${time}`
  const instant = fromZonedTime(`${date}T${time}:00`, timezone)
  if (formatInTimeZone(instant, timezone, 'yyyy-MM-dd HH:mm') !== wallTime) {
    throw new Error(`Attendance time ${wallTime} does not exist in ${timezone}`)
  }
  for (const delta of [-60, 60]) {
    const alternate = new Date(instant.getTime() + delta * 60_000)
    if (formatInTimeZone(alternate, timezone, 'yyyy-MM-dd HH:mm') === wallTime) {
      throw new Error(`Attendance time ${wallTime} is ambiguous in ${timezone}`)
    }
  }
  return instant.toISOString()
}

function nextCalendarDate(date: string) {
  const instant = new Date(`${date}T00:00:00.000Z`)
  instant.setUTCDate(instant.getUTCDate() + 1)
  return instant.toISOString().slice(0, 10)
}

function shiftMinutes(value: string, minutes: number) {
  return new Date(Date.parse(value) + minutes * 60_000).toISOString()
}

function validatePolicy(policy: BaraAttendanceWindowPolicy) {
  if (!LOCAL_TIME.test(policy.sessionStartsAtLocal) || !LOCAL_TIME.test(policy.sessionEndsAtLocal)) {
    throw new Error('Attendance scheduling requires HH:mm local times')
  }
  if (policy.sessionEndDayOffset !== 0 && policy.sessionEndDayOffset !== 1) {
    throw new Error('Attendance session end day offset is invalid')
  }
  for (const value of [policy.entryOpensMinutesBefore, policy.presentGraceMinutes,
    policy.entryClosesMinutesBeforeEnd, policy.absentMinutesBeforeEnd]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 720) {
      throw new Error('Attendance timing offsets must be whole minutes from 0 to 720')
    }
  }
  if (!Number.isSafeInteger(policy.policyRevision) || policy.policyRevision < 1) {
    throw new Error('Attendance policy revision is invalid')
  }
}

export function materializeBaraAttendanceSchedule(
  input: BuildBaraScheduleSnapshotInput,
): MaterializedBaraAttendanceSchedule {
  requireMappedRef(input.installationRef, 'pika')
  requireMappedRef(input.rosterRef, 'roster')
  if (!isCalendarDate(input.windowStart) || !isCalendarDate(input.windowEnd)) {
    throw new Error('Attendance scheduling requires a valid date window')
  }
  if (input.windowStart > input.windowEnd) throw new Error('Attendance scheduling window is reversed')
  validatePolicy(input.policy)

  const includedDates = new Set<string>()
  const includedRefs = new Set<string>()
  const cutoffs = input.classDays
    .filter((day) => day.isClassDay && day.date >= input.windowStart && day.date <= input.windowEnd)
    .map((day): BaraAttendanceCutoffSnapshot => {
      if (!isCalendarDate(day.date)) throw new Error('Attendance class day has an invalid date')
      requireMappedRef(day.occurrenceRef, 'occurrence')
      if (includedDates.has(day.date) || includedRefs.has(day.occurrenceRef)) {
        throw new Error('Attendance class day mappings must be unique')
      }
      includedDates.add(day.date)
      includedRefs.add(day.occurrenceRef)
      if (day.frozenCutoffs) return day.frozenCutoffs

      const sessionStartsAt = materializeLocalInstant(
        day.date, input.policy.sessionStartsAtLocal, input.policy.timezone,
      )
      const sessionEndsAt = materializeLocalInstant(
        input.policy.sessionEndDayOffset === 1 ? nextCalendarDate(day.date) : day.date,
        input.policy.sessionEndsAtLocal, input.policy.timezone,
      )
      const cutoff: BaraAttendanceCutoffSnapshot = {
        occurrence_ref: day.occurrenceRef,
        date: day.date,
        accepts_at: shiftMinutes(sessionStartsAt, -input.policy.entryOpensMinutesBefore),
        stops_accepting_at: shiftMinutes(sessionEndsAt, -input.policy.entryClosesMinutesBeforeEnd),
        session_starts_at: sessionStartsAt,
        session_ends_at: sessionEndsAt,
        present_through_at: shiftMinutes(sessionStartsAt, input.policy.presentGraceMinutes),
        absent_at: shiftMinutes(sessionEndsAt, -input.policy.absentMinutesBeforeEnd),
        policy_revision: input.policy.policyRevision,
      }
      if (!(Date.parse(cutoff.accepts_at) <= Date.parse(cutoff.session_starts_at)
        && Date.parse(cutoff.session_starts_at) <= Date.parse(cutoff.present_through_at)
        && Date.parse(cutoff.present_through_at) < Date.parse(cutoff.stops_accepting_at)
        && Date.parse(cutoff.stops_accepting_at) <= Date.parse(cutoff.absent_at)
        && Date.parse(cutoff.absent_at) <= Date.parse(cutoff.session_ends_at))) {
        throw new Error('Attendance timing windows are contradictory')
      }
      return cutoff
    })
    .sort((left, right) => left.date.localeCompare(right.date)
      || left.occurrence_ref.localeCompare(right.occurrence_ref))

  const validation = validateV1Message({
    schema_version: 1,
    message_type: 'schedule.snapshot',
    idempotency_key: input.idempotencyKey,
    correlation_ref: input.correlationRef,
    installation_ref: input.installationRef,
    roster_ref: input.rosterRef,
    revision: input.revision,
    timezone: input.policy.timezone,
    window_start: input.windowStart,
    window_end: input.windowEnd,
    occurrences: cutoffs.map((cutoff) => ({
      occurrence_ref: cutoff.occurrence_ref,
      date: cutoff.date,
      title: input.attendanceTitle,
      accepts_at: cutoff.accepts_at,
      stops_accepting_at: cutoff.stops_accepting_at,
    })),
  })
  if (!validation.ok || validation.value.message_type !== 'schedule.snapshot') {
    throw new Error('Attendance schedule does not satisfy the v1 contract')
  }
  return { schedule: validation.value, cutoffs }
}

export function buildBaraScheduleSnapshot(input: BuildBaraScheduleSnapshotInput) {
  return materializeBaraAttendanceSchedule(input).schedule
}
