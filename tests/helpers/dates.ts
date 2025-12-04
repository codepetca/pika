/**
 * Date helper functions for testing
 * Provides date-agnostic test date generation
 */

/**
 * Find the first occurrence of a specific day of week in a month
 * @param year - Year
 * @param month - Month (0-11, JavaScript convention)
 * @param dayOfWeek - Day of week (0=Sunday, 1=Monday, etc.)
 */
export function findFirstDayOfWeekInMonth(
  year: number,
  month: number,
  dayOfWeek: number
): Date {
  const date = new Date(year, month, 1)
  while (date.getDay() !== dayOfWeek) {
    date.setDate(date.getDate() + 1)
  }
  return date
}

/**
 * Find the Nth occurrence of a specific day of week in a month
 * @param year - Year
 * @param month - Month (0-11)
 * @param dayOfWeek - Day of week (0=Sunday, 1=Monday, etc.)
 * @param occurrence - Which occurrence (1=first, 2=second, etc.)
 */
export function findNthDayOfWeekInMonth(
  year: number,
  month: number,
  dayOfWeek: number,
  occurrence: number
): Date {
  const firstOccurrence = findFirstDayOfWeekInMonth(year, month, dayOfWeek)
  firstOccurrence.setDate(firstOccurrence.getDate() + (occurrence - 1) * 7)
  return firstOccurrence
}

/**
 * Find the next weekday (Mon-Fri) from a given date
 */
export function findNextWeekday(date: Date): Date {
  const result = new Date(date)
  while (result.getDay() === 0 || result.getDay() === 6) {
    result.setDate(result.getDate() + 1)
  }
  return result
}

/**
 * Find the previous weekday (Mon-Fri) from a given date
 */
export function findPreviousWeekday(date: Date): Date {
  const result = new Date(date)
  while (result.getDay() === 0 || result.getDay() === 6) {
    result.setDate(result.getDate() - 1)
  }
  return result
}

/**
 * Find the next Saturday from a given date
 */
export function findNextSaturday(date: Date): Date {
  const result = new Date(date)
  while (result.getDay() !== 6) {
    result.setDate(result.getDate() + 1)
  }
  return result
}

/**
 * Find the next Sunday from a given date
 */
export function findNextSunday(date: Date): Date {
  const result = new Date(date)
  while (result.getDay() !== 0) {
    result.setDate(result.getDate() + 1)
  }
  return result
}

/**
 * Add days to a date
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

/**
 * Format date as YYYY-MM-DD
 */
export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Get a week range starting from a Monday
 */
export function getWeekRangeFromMonday(year: number, month: number): { start: Date; end: Date } {
  const monday = findFirstDayOfWeekInMonth(year, month, 1) // First Monday
  const sunday = addDays(monday, 6)
  return { start: monday, end: sunday }
}

/**
 * Get a date range that only includes weekends
 */
export function getWeekendOnlyRange(year: number, month: number): { start: Date; end: Date } {
  const saturday = findFirstDayOfWeekInMonth(year, month, 6)
  const sunday = addDays(saturday, 1)
  return { start: saturday, end: sunday }
}

/**
 * Get a weekday-only range (Mon-Fri with no holidays)
 */
export function getWeekdayRange(year: number, month: number): { start: Date; end: Date } {
  const monday = findFirstDayOfWeekInMonth(year, month, 1)
  // Skip first week to avoid potential month-boundary holidays
  const start = addDays(monday, 14) // Third Monday
  const end = addDays(start, 4) // Friday of same week
  return { start, end }
}
