import { format, parseISO, startOfWeek, addDays, addWeeks, subWeeks } from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import type { FuturePlansVisibility } from '@/types'

const TORONTO_TZ = 'America/Toronto'

/**
 * Returns the Monday (week start) for a given date string.
 * Week starts on Monday (ISO standard).
 */
export function getWeekStartForDate(dateStr: string): string {
  const date = parseISO(dateStr)
  const monday = startOfWeek(date, { weekStartsOn: 1 }) // 1 = Monday
  return format(monday, 'yyyy-MM-dd')
}

/**
 * Returns an array of 5 dates (Mon-Fri) for a week starting from the given Monday.
 */
export function getWeekDays(weekStartStr: string): string[] {
  const monday = parseISO(weekStartStr)
  const days: string[] = []
  for (let i = 0; i < 5; i++) {
    days.push(format(addDays(monday, i), 'yyyy-MM-dd'))
  }
  return days
}

/**
 * Returns the Monday of the next week.
 */
export function getNextWeekStart(weekStartStr: string): string {
  const monday = parseISO(weekStartStr)
  return format(addWeeks(monday, 1), 'yyyy-MM-dd')
}

/**
 * Returns the Monday of the previous week.
 */
export function getPreviousWeekStart(weekStartStr: string): string {
  const monday = parseISO(weekStartStr)
  return format(subWeeks(monday, 1), 'yyyy-MM-dd')
}

/**
 * Returns the Monday of the current week in Toronto timezone.
 */
export function getCurrentWeekStart(): string {
  const nowInToronto = toZonedTime(new Date(), TORONTO_TZ)
  const monday = startOfWeek(nowInToronto, { weekStartsOn: 1 })
  return format(monday, 'yyyy-MM-dd')
}

/**
 * Determines if a student can view a given week based on the visibility setting.
 *
 * @param targetWeekStart - The Monday of the week the student wants to view
 * @param visibility - The classroom's future_plans_visibility setting
 * @param currentWeekStart - The Monday of the current week (for comparison)
 * @returns true if the student can view the week
 */
export function canStudentViewWeek(
  targetWeekStart: string,
  visibility: FuturePlansVisibility,
  currentWeekStart: string
): boolean {
  // Past and current weeks are always visible
  if (targetWeekStart <= currentWeekStart) {
    return true
  }

  // Future weeks depend on visibility setting
  switch (visibility) {
    case 'current':
      // Only current and past weeks (already handled above)
      return false

    case 'next': {
      // Current week + next week
      const nextWeek = getNextWeekStart(currentWeekStart)
      return targetWeekStart <= nextWeek
    }

    case 'all':
      // No restrictions
      return true

    default:
      return false
  }
}
