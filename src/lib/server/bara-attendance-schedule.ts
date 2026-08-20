import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { V1ScheduleSnapshot } from '@/vendor/attendance-contract/v1/types'
import { validateV1Message } from '@/vendor/attendance-contract/v1/validate'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export interface BaraAttendanceWindowPolicy {
  timezone: 'America/Toronto'
  opensAtLocal: string
  closesAtLocal: string
  closeDayOffset: 0 | 1
}

export interface BaraAttendanceClassDay {
  date: string
  isClassDay: boolean
  occurrenceRef: string
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
  return instant.toISOString()
}

function nextCalendarDate(date: string) {
  const instant = new Date(`${date}T00:00:00.000Z`)
  instant.setUTCDate(instant.getUTCDate() + 1)
  return instant.toISOString().slice(0, 10)
}

export function buildBaraScheduleSnapshot(
  input: BuildBaraScheduleSnapshotInput,
): V1ScheduleSnapshot {
  requireMappedRef(input.installationRef, 'pika')
  requireMappedRef(input.rosterRef, 'roster')
  if (!isCalendarDate(input.windowStart) || !isCalendarDate(input.windowEnd)) {
    throw new Error('Attendance scheduling requires a valid date window')
  }
  if (input.windowStart > input.windowEnd) {
    throw new Error('Attendance scheduling window is reversed')
  }
  if (!LOCAL_TIME.test(input.policy.opensAtLocal) || !LOCAL_TIME.test(input.policy.closesAtLocal)) {
    throw new Error('Attendance scheduling requires HH:mm local times')
  }
  if (input.policy.closeDayOffset !== 0 && input.policy.closeDayOffset !== 1) {
    throw new Error('Attendance close day offset is invalid')
  }
  if (
    input.policy.closeDayOffset === 0 &&
    input.policy.closesAtLocal <= input.policy.opensAtLocal
  ) {
    throw new Error('Attendance close time must be after open time')
  }

  const includedDates = new Set<string>()
  const includedRefs = new Set<string>()
  const occurrences = input.classDays
    .filter((day) =>
      day.isClassDay && day.date >= input.windowStart && day.date <= input.windowEnd,
    )
    .map((day) => {
      if (!isCalendarDate(day.date)) {
        throw new Error('Attendance class day has an invalid date')
      }
      requireMappedRef(day.occurrenceRef, 'occurrence')
      if (includedDates.has(day.date) || includedRefs.has(day.occurrenceRef)) {
        throw new Error('Attendance class day mappings must be unique')
      }
      includedDates.add(day.date)
      includedRefs.add(day.occurrenceRef)

      const opensAt = materializeLocalInstant(
        day.date,
        input.policy.opensAtLocal,
        input.policy.timezone,
      )
      const closesAt = materializeLocalInstant(
        input.policy.closeDayOffset === 1 ? nextCalendarDate(day.date) : day.date,
        input.policy.closesAtLocal,
        input.policy.timezone,
      )
      if (Date.parse(opensAt) >= Date.parse(closesAt)) {
        throw new Error('Attendance close time must be after open time')
      }
      return {
        occurrence_ref: day.occurrenceRef,
        date: day.date,
        title: input.attendanceTitle,
        opens_at: opensAt,
        closes_at: closesAt,
      }
    })
    .sort((left, right) =>
      left.date.localeCompare(right.date) || left.occurrence_ref.localeCompare(right.occurrence_ref),
    )

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
    occurrences,
  })
  if (!validation.ok || validation.value.message_type !== 'schedule.snapshot') {
    throw new Error('Attendance schedule does not satisfy the v1 contract')
  }
  return validation.value
}
