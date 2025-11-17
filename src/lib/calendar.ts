import { parse, eachDayOfInterval, isWeekend, format } from 'date-fns'
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
 * Ontario statutory holidays and school breaks
 * These are for the 2024-2025 school year
 * Update annually as needed
 */
export const ONTARIO_HOLIDAYS_2024_2025: string[] = [
  // Semester 1 (Fall 2024)
  '2024-09-02', // Labour Day
  '2024-10-14', // Thanksgiving
  '2024-12-23', // Winter Break starts
  '2024-12-24',
  '2024-12-25', // Christmas
  '2024-12-26', // Boxing Day
  '2024-12-27',
  '2024-12-28',
  '2024-12-29',
  '2024-12-30',
  '2024-12-31',
  '2025-01-01', // New Year's Day
  '2025-01-02',
  '2025-01-03', // Winter Break ends

  // Semester 2 (Winter/Spring 2025)
  '2025-02-17', // Family Day
  '2025-03-10', // March Break starts
  '2025-03-11',
  '2025-03-12',
  '2025-03-13',
  '2025-03-14', // March Break ends
  '2025-04-18', // Good Friday
  '2025-04-21', // Easter Monday
  '2025-05-19', // Victoria Day
]

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
 * Generates all class days for a semester, excluding weekends and holidays
 */
export function generateClassDays(semester: Semester, year: number): string[] {
  const { start, end } = getSemesterDates(semester, year)

  // Get all dates in the range
  const allDates = eachDayOfInterval({ start, end })

  // Filter out weekends and holidays
  const classDays = allDates
    .filter(date => !isWeekend(date))
    .filter(date => {
      const dateString = format(date, 'yyyy-MM-dd')
      return !ONTARIO_HOLIDAYS_2024_2025.includes(dateString)
    })
    .map(date => format(date, 'yyyy-MM-dd'))

  return classDays
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
