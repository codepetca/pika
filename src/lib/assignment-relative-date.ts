import { getTodayInToronto } from '@/lib/timezone'
import type { ClassDay } from '@/types'

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

  const due = new Date(`${dueAt}T00:00:00`)
  const todayDate = new Date(`${today}T00:00:00`)
  const diffTime = due.getTime() - todayDate.getTime()
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return { text: 'today', isPast: false }
  if (diffDays === 1) return { text: 'tomorrow', isPast: false }
  if (diffDays === -1) return { text: 'yesterday', isPast: true }
  if (diffDays > 0) return { text: `in ${diffDays} days`, isPast: false }
  return { text: `${Math.abs(diffDays)} days ago`, isPast: true }
}
