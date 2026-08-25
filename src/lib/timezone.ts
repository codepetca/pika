import { format, parse, subDays } from 'date-fns'
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz'

const TIMEZONE = 'America/Toronto'

/**
 * Converts a UTC date to Toronto time
 */
export function toTorontoTime(date: Date): Date {
  return toZonedTime(date, TIMEZONE)
}

/**
 * Converts a Toronto time to UTC
 */
export function fromTorontoTime(date: Date): Date {
  return fromZonedTime(date, TIMEZONE)
}

/**
 * Gets the current time in Toronto timezone
 */
export function nowInToronto(): Date {
  return toTorontoTime(new Date())
}

/**
 * Formats a date in Toronto timezone to YYYY-MM-DD
 */
export function formatDateInToronto(date: Date): string {
  const torontoDate = toTorontoTime(date)
  return format(torontoDate, 'yyyy-MM-dd')
}

/**
 * Converts a Toronto date string (YYYY-MM-DD) to end-of-day ISO timestamp.
 */
export function toTorontoEndOfDayIso(dateString: string): string {
  const date = parse(dateString, 'yyyy-MM-dd', new Date())
  date.setHours(23, 59, 0, 0)
  return fromTorontoTime(date).toISOString()
}

/**
 * Converts a Toronto date string (YYYY-MM-DD) to its start-of-day ISO timestamp.
 */
export function toTorontoStartOfDayIso(dateString: string): string {
  const date = parse(dateString, 'yyyy-MM-dd', new Date())
  date.setHours(0, 0, 0, 0)
  return fromTorontoTime(date).toISOString()
}

/**
 * Checks if an entry was submitted on time
 * On-time = updated_at (Toronto time) < midnight of next day (i.e., before the date changes)
 */
export function isOnTime(updatedAt: Date, dateString: string): boolean {
  // Parse the date string (YYYY-MM-DD) in Toronto timezone
  const targetDate = parse(dateString, 'yyyy-MM-dd', new Date())

  // Create deadline: midnight of the NEXT day (start of next day) in Toronto time
  const deadlineInToronto = new Date(targetDate)
  deadlineInToronto.setHours(24, 0, 0, 0) // or equivalently, next day at 00:00:00

  // Convert deadline to UTC for comparison
  const deadlineUTC = fromTorontoTime(deadlineInToronto)

  // Compare - submission must be strictly before midnight (start of next day)
  return updatedAt < deadlineUTC
}

/**
 * Gets today's date in Toronto timezone as YYYY-MM-DD
 */
export function getTodayInToronto(): string {
  return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd')
}

/**
 * Formats a timestamp relative to the current Toronto calendar day.
 *
 * Examples: "Today 10:36 AM", "Yesterday 11:34 AM", "Tue Jun 23 8:21 AM".
 */
export function formatRelativeDateTimeInToronto(
  value: Date | string,
  referenceDate = new Date(),
): string {
  const date = typeof value === 'string' ? new Date(value) : value
  const dateKey = formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd')
  const todayKey = formatInTimeZone(referenceDate, TIMEZONE, 'yyyy-MM-dd')
  const yesterdayKey = format(subDays(toTorontoTime(referenceDate), 1), 'yyyy-MM-dd')
  const time = formatInTimeZone(date, TIMEZONE, 'h:mm a')

  if (dateKey === todayKey) return `Today ${time}`
  if (dateKey === yesterdayKey) return `Yesterday ${time}`
  return formatInTimeZone(date, TIMEZONE, 'EEE MMM d h:mm a')
}
