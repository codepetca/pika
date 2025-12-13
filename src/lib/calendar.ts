import { parse, eachDayOfInterval, isWeekend, format, addDays } from 'date-fns'
import Holidays from 'date-holidays'
import type { Semester, SemesterRange } from '@/types'

// Semester date ranges
export const SEMESTER_RANGES: Record<Semester, SemesterRange> = {
  semester1: {
    start: '09-01', // September 1
    end: '01-30',   // January 30
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
  const hd = new Holidays('CA', 'ON') // Canada, Ontario
  const holidays: string[] = []

  // Get all holidays in the date range
  const allDates = eachDayOfInterval({ start: startDate, end: endDate })

  allDates.forEach(date => {
    const dateHolidays = hd.isHoliday(date)
    if (dateHolidays) {
      holidays.push(format(date, 'yyyy-MM-dd'))
    }
  })

  // Add school-specific breaks (Winter Break and March Break)
  // These are not statutory holidays but are days when school is closed
  const startYear = startDate.getFullYear()
  const endYear = endDate.getFullYear()
  const startMonth = startDate.getMonth()
  const endMonth = endDate.getMonth()

  // Winter Break: Dec 23 - Jan 3 (approximately)
  // Check if date range includes December
  // Range includes December if:
  // 1. Start month is December (11), OR
  // 2. End month is December (11), OR
  // 3. Start is before December and end is in next year (spans December)
  if (startMonth === 11 || endMonth === 11 || (startMonth < 11 && endYear > startYear)) {
    for (let day = 23; day <= 31; day++) {
      holidays.push(`${startYear}-12-${String(day).padStart(2, '0')}`)
    }
  }

  // Check if date range includes January (next year for winter break)
  // This handles cases where the range spans into January of the next year
  if (endMonth === 0 && endYear > startYear) {
    // End date is in January of next year
    holidays.push(`${endYear}-01-02`)
    holidays.push(`${endYear}-01-03`)
  } else if (startMonth === 11 && endYear > startYear) {
    // Start is in December and end is in next year
    holidays.push(`${endYear}-01-02`)
    holidays.push(`${endYear}-01-03`)
  }

  // March Break: Second full week of March (Mon-Fri)
  // Check if date range includes March
  if (startDate.getMonth() <= 2 && endDate.getMonth() >= 2) {
    const marchYear = endDate.getMonth() === 2 ? endYear : startYear
    // Find second Monday of March
    const marchFirst = new Date(marchYear, 2, 1) // March 1
    const firstMonday = marchFirst.getDay() === 1 ? marchFirst :
                       addDays(marchFirst, (8 - marchFirst.getDay()) % 7)
    const secondMonday = addDays(firstMonday, 7)

    // Add Monday through Friday of March Break
    for (let i = 0; i < 5; i++) {
      const breakDay = addDays(secondMonday, i)
      holidays.push(format(breakDay, 'yyyy-MM-dd'))
    }
  }

  return [...new Set(holidays)] // Remove duplicates
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

  const start = parse(`${startYear}-${range.start}`, 'yyyy-MM-dd', new Date())
  const end = parse(`${endYear}-${range.end}`, 'yyyy-MM-dd', new Date())

  return { start, end }
}

/**
 * Generates all class days for a date range, excluding weekends and holidays
 */
export function generateClassDaysFromRange(startDate: Date, endDate: Date): string[] {
  // Get all holidays in the range
  const holidays = getOntarioHolidays(startDate, endDate)
  const holidaySet = new Set(holidays)

  // Get all dates in the range
  const allDates = eachDayOfInterval({ start: startDate, end: endDate })

  // Filter out weekends and holidays
  const classDays = allDates
    .filter(date => !isWeekend(date))
    .filter(date => {
      const dateString = format(date, 'yyyy-MM-dd')
      return !holidaySet.has(dateString)
    })
    .map(date => format(date, 'yyyy-MM-dd'))

  return classDays
}

/**
 * Generates all class days for a semester, excluding weekends and holidays
 */
export function generateClassDays(semester: Semester, year: number): string[] {
  const { start, end } = getSemesterDates(semester, year)
  return generateClassDaysFromRange(start, end)
}

/**
 * Determines which semester a date belongs to
 */
export function getSemesterForDate(date: Date, year: number): Semester | null {
  const sem1 = getSemesterDates('semester1', year)
  const sem2 = getSemesterDates('semester2', year)

  if (date >= sem1.start && date <= sem1.end) {
    return 'semester1'
  }

  if (date >= sem2.start && date <= sem2.end) {
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
