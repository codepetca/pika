import { getTodayInToronto } from '@/lib/timezone'
import type { ClassDay } from '@/types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

function toUtcDateOnlyMs(dateString: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null

  const utcMs = Date.UTC(year, month - 1, day)
  const utcDate = new Date(utcMs)

  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    return null
  }

  return utcMs
}

function countClassDaysBetween(classDays: ClassDay[], fromDate: string, toDate: string): number {
  const start = fromDate < toDate ? fromDate : toDate
  const end = fromDate < toDate ? toDate : fromDate
  const count = classDays.filter((day) =>
    day.is_class_day && day.date > start && day.date <= end
  ).length
  return fromDate < toDate ? count : -count
}

export interface RelativeDueDate {
  text: string
  isPast: boolean
}

export function getRelativeDueDate(dueAt: string, classDays?: ClassDay[]): RelativeDueDate | null {
  if (!dueAt) return null

  const today = getTodayInToronto()
  const dueMs = toUtcDateOnlyMs(dueAt)
  if (dueMs === null) return null

  if (classDays && classDays.length > 0) {
    const classCount = countClassDaysBetween(classDays, today, dueAt)
    const isPast = classCount < 0
    const absCount = Math.abs(classCount)

    if (dueAt === today) return { text: 'today', isPast: false }
    if (absCount === 0 || absCount === 1) {
      return isPast
        ? { text: 'last class', isPast: true }
        : { text: 'next class', isPast: false }
    }
    return isPast
      ? { text: `${absCount} classes ago`, isPast: true }
      : { text: `in ${absCount} classes`, isPast: false }
  }

  const todayMs = toUtcDateOnlyMs(today)
  if (todayMs === null) return null

  const diffDays = Math.round((dueMs - todayMs) / MS_PER_DAY)

  if (diffDays === 0) return { text: 'today', isPast: false }
  if (diffDays === 1) return { text: 'tomorrow', isPast: false }
  if (diffDays === -1) return { text: 'yesterday', isPast: true }
  if (diffDays > 0) return { text: `in ${diffDays} days`, isPast: false }
  return { text: `${Math.abs(diffDays)} days ago`, isPast: true }
}
