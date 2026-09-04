import { parse, isWeekend } from 'date-fns'
import { formatInTimeZone, toZonedTime } from 'date-fns-tz'
import Holidays from 'date-holidays'
import type { Semester, SemesterRange } from '@/types'

const TIMEZONE = 'America/Toronto'
const NOON_UTC_HOUR = 12
const ontarioHolidayCalendar = new Holidays('CA', 'ON')
ontarioHolidayCalendar.setTimezone(TIMEZONE)
const publicHolidayCache = new Map<number, string[]>()

// Semester date ranges
export const SEMESTER_RANGES: Record<Semester, SemesterRange> = {
  semester1: {
    start: '09-01', // September 1
    end: '01-31',   // January 31
  },
  semester2: {
    start: '02-01', // February 1
    end: '06-30',   // June 30
  },
}

/**
 * Gets Ontario statutory holidays and school breaks for a date range
 * Uses date-holidays library for automatic calculation
 */
export function getOntarioHolidays(startDate: Date, endDate: Date): string[] {
  const holidays: string[] = []
  const normalizedStartDate = toUtcNoon(startDate)
  const normalizedEndDate = toUtcNoon(endDate)
  const startDateKey = formatInTimeZone(normalizedStartDate, TIMEZONE, 'yyyy-MM-dd')
  const endDateKey = formatInTimeZone(normalizedEndDate, TIMEZONE, 'yyyy-MM-dd')

  const startYear = normalizedStartDate.getUTCFullYear()
  const endYear = normalizedEndDate.getUTCFullYear()
  const startMonth = normalizedStartDate.getUTCMonth()
  const endMonth = normalizedEndDate.getUTCMonth()

  for (let year = startYear; year <= endYear; year++) {
    for (const holiday of getPublicOntarioHolidaysForYear(year)) {
      if (holiday >= startDateKey && holiday <= endDateKey) {
        holidays.push(holiday)
      }
    }
  }

  // Add school-specific breaks (Winter Break and March Break)
  // These are not statutory holidays but are days when school is closed

  // Winter Break: Dec 22 - Jan 3 (approximately)
  // Check if date range includes December
  // Range includes December if:
  // 1. Start month is December (11), OR
  // 2. End month is December (11), OR
  // 3. Start is before December and end is in next year (spans December)
  if (startMonth === 11 || endMonth === 11 || (startMonth < 11 && endYear > startYear)) {
    for (let day = 22; day <= 31; day++) {
      holidays.push(`${startYear}-12-${String(day).padStart(2, '0')}`)
    }
  }

  // Check if date range includes January (Jan 2-3 winter break)
  const includesJanuaryInStartYear = startMonth === 0
  const includesJanuaryInEndYear = endMonth === 0
  const spansYearBoundary = endYear > startYear

  if (includesJanuaryInStartYear) {
    holidays.push(`${startYear}-01-02`)
    holidays.push(`${startYear}-01-03`)
  }

  if (includesJanuaryInEndYear || spansYearBoundary) {
    holidays.push(`${endYear}-01-02`)
    holidays.push(`${endYear}-01-03`)
  }

  // March Break: Second full week of March (Mon-Fri)
  // Check if date range includes March
  if (startMonth <= 2 && (endYear > startYear || endMonth >= 2)) {
    const marchYear = endMonth === 2 ? endYear : startYear
    // Find second Monday of March
    const marchFirst = new Date(Date.UTC(marchYear, 2, 1, NOON_UTC_HOUR)) // March 1
    const marchFirstToronto = toZonedTime(marchFirst, TIMEZONE)
    const marchFirstDay = marchFirstToronto.getDay()
    const offsetToMonday = marchFirstDay === 1 ? 0 : (8 - marchFirstDay) % 7
    const firstMonday = addDaysUtc(marchFirst, offsetToMonday)
    const secondMonday = addDaysUtc(firstMonday, 7)

    // Add Monday through Friday of March Break
    for (let i = 0; i < 5; i++) {
      const breakDay = addDaysUtc(secondMonday, i)
      holidays.push(formatInTimeZone(breakDay, TIMEZONE, 'yyyy-MM-dd'))
    }
  }

  return [...new Set(holidays)]
}

/**
 * Gets the start and end dates for a semester in a specific year
 */
export function getSemesterDates(semester: Semester, year: number): { start: Date; end: Date } {
  const range = SEMESTER_RANGES[semester]

  let startYear = year
  let endYear = year

  // Semester 1 spans two calendar years (Sept -> Jan)
  if (semester === 'semester1') {
    endYear = year + 1
  }

  const start = toUtcNoon(parse(`${startYear}-${range.start}`, 'yyyy-MM-dd', new Date()))
  const end = toUtcNoon(parse(`${endYear}-${range.end}`, 'yyyy-MM-dd', new Date()))

  return { start, end }
}

/**
 * Generates the initial class-day draft for a date range.
 *
 * Every Monday-Friday is included intentionally. School holidays, PA days,
 * exam days, and local schedule exceptions vary too much to infer reliably;
 * teachers review and toggle those dates in Classroom Settings.
 */
export function generateClassDaysFromRange(startDate: Date, endDate: Date): string[] {
  const allDates = getUtcNoonRange(startDate, endDate)

  return allDates
    .filter(date => !isWeekend(toZonedTime(date, TIMEZONE)))
    .map(date => formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd'))
}

/**
 * Provides the next standard school-term boundary for first-day-only setup.
 * January-June dates use June 30; July-December dates use January 31 of the
 * following year. If June 30 itself is selected, the next January 31 is used
 * so the end remains after the start. Teachers can edit this in Settings.
 */
export function getDefaultClassroomEndDate(startDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startDate)
  if (!match) return ''

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
  const parsed = new Date(Date.UTC(year, monthIndex, day, NOON_UTC_HOUR))
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== monthIndex ||
    parsed.getUTCDate() !== day
  ) {
    return ''
  }

  if (monthIndex < 5 || (monthIndex === 5 && day < 30)) {
    return `${year}-06-30`
  }

  return `${year + 1}-01-31`
}

/**
 * Generates every Monday-Friday in a semester for teacher review.
 */
export function generateClassDays(semester: Semester, year: number): string[] {
  const { start, end } = getSemesterDates(semester, year)
  return generateClassDaysFromRange(start, end)
}

/**
 * Determines which semester a date belongs to
 */
export function getSemesterForDate(date: Date, year: number): Semester | null {
  const normalizedDate = toUtcNoon(date)
  const sem1 = getSemesterDates('semester1', year)
  const sem2 = getSemesterDates('semester2', year)

  if (normalizedDate >= sem1.start && normalizedDate <= sem1.end) {
    return 'semester1'
  }

  if (normalizedDate >= sem2.start && normalizedDate <= sem2.end) {
    return 'semester2'
  }

  return null
}

/**
 * Gets the current semester
 */
export function getCurrentSemester(): { semester: Semester; year: number } | null {
  const now = new Date()
  const currentYear = now.getFullYear()

  // Check current year
  let semester = getSemesterForDate(now, currentYear)
  if (semester) {
    return { semester, year: currentYear }
  }

  // Check previous year (for semester 1 in Jan)
  semester = getSemesterForDate(now, currentYear - 1)
  if (semester) {
    return { semester, year: currentYear - 1 }
  }

  return null
}

function toUtcNoon(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), NOON_UTC_HOUR))
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days, NOON_UTC_HOUR))
}

function getUtcNoonRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = []
  let current = toUtcNoon(startDate)
  const end = toUtcNoon(endDate)

  while (current <= end) {
    dates.push(current)
    current = addDaysUtc(current, 1)
  }

  return dates
}

function getPublicOntarioHolidaysForYear(year: number): string[] {
  const cached = publicHolidayCache.get(year)
  if (cached) return cached

  const holidays = ontarioHolidayCalendar
    .getHolidays(year)
    .filter((holiday) => holiday.type === 'public')
    .map((holiday) => {
      if (typeof holiday.date === 'string' && holiday.date.length > 0) {
        return holiday.date.split(' ')[0]
      }

      if (holiday.start instanceof Date) {
        return formatInTimeZone(holiday.start, TIMEZONE, 'yyyy-MM-dd')
      }

      return String(holiday.date).split(' ')[0]
    })

  const deduped = [...new Set(holidays)]
  publicHolidayCache.set(year, deduped)
  return deduped
}
