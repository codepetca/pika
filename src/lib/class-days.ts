import type { ClassDay } from '@/types'

export function isClassDayOnDate(classDays: ClassDay[], date: string): boolean {
  const found = classDays.find(day => day.date === date)
  return Boolean(found?.is_class_day)
}

export function getMostRecentClassDayBefore(
  classDays: ClassDay[],
  beforeDate: string
): string | null {
  const candidates = classDays
    .filter(day => day.is_class_day)
    .map(day => day.date)
    .filter(date => date < beforeDate)
    .sort()

  return candidates.length ? candidates[candidates.length - 1] : null
}

