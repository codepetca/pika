import { formatInTimeZone } from 'date-fns-tz'
import type { Announcement, Assignment } from '@/types'

export const CLASSROOM_CALENDAR_TIMEZONE = 'America/Toronto'

export function getCalendarAssignmentDate(
  assignment: Pick<Assignment, 'due_at'>,
): string | null {
  const dueAt = new Date(assignment.due_at)
  if (Number.isNaN(dueAt.getTime())) return null

  return formatInTimeZone(
    dueAt,
    CLASSROOM_CALENDAR_TIMEZONE,
    'yyyy-MM-dd',
  )
}

export function isCalendarAnnouncementScheduled(
  announcement: Pick<Announcement, 'scheduled_for'>,
  now: Date = new Date(),
): boolean {
  if (!announcement.scheduled_for) return false
  return new Date(announcement.scheduled_for) > now
}

export function getCalendarAnnouncementDate(
  announcement: Pick<Announcement, 'scheduled_for' | 'created_at'>,
  now: Date = new Date(),
): string | null {
  const dateToUse = isCalendarAnnouncementScheduled(announcement, now)
    ? announcement.scheduled_for!
    : announcement.created_at
  const date = new Date(dateToUse)
  if (Number.isNaN(date.getTime())) return null

  return formatInTimeZone(
    date,
    CLASSROOM_CALENDAR_TIMEZONE,
    'yyyy-MM-dd',
  )
}
