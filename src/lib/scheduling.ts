import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export const SCHEDULING_TIMEZONE = 'America/Toronto'
export const DEFAULT_SCHEDULE_TIME = '07:00'

export interface ScheduleDateTimeParts {
  date: string
  time: string
}

export function getTodayInSchedulingTimezone(): string {
  return formatInTimeZone(new Date(), SCHEDULING_TIMEZONE, 'yyyy-MM-dd')
}

export function combineScheduleDateTimeToIso(date: string, time?: string): string {
  const normalizedTime = normalizeScheduleTime(time)
  return fromZonedTime(`${date}T${normalizedTime}:00`, SCHEDULING_TIMEZONE).toISOString()
}

export function parseScheduleIsoToParts(isoString: string): ScheduleDateTimeParts {
  return {
    date: formatInTimeZone(new Date(isoString), SCHEDULING_TIMEZONE, 'yyyy-MM-dd'),
    time: formatInTimeZone(new Date(isoString), SCHEDULING_TIMEZONE, 'HH:mm'),
  }
}

export function isScheduleIsoInFuture(isoString: string, now: Date = new Date()): boolean {
  const scheduleDate = new Date(isoString)
  return scheduleDate.getTime() > now.getTime()
}

export function isVisibleAtNow(isoString: string | null | undefined, now: Date = new Date()): boolean {
  if (!isoString) return true
  return new Date(isoString).getTime() <= now.getTime()
}

export function normalizeScheduleTime(time?: string): string {
  if (!time) return DEFAULT_SCHEDULE_TIME
  return time
}

