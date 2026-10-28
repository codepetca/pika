import { postDateSchema } from '@/lib/validations/post-date'
import { formatInTimeZone } from 'date-fns-tz'
import type { Announcement, Assignment, ClassworkMaterial, TestAssessment } from '@/types'

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
  announcement: Pick<Announcement, 'is_draft' | 'scheduled_for'>,
  now: Date = new Date(),
): boolean {
  if (announcement.is_draft) return false
  if (!announcement.scheduled_for) return false
  return new Date(announcement.scheduled_for) > now
}

export function getCalendarAnnouncementDate(
  announcement: Pick<Announcement, 'is_draft' | 'published_at' | 'scheduled_for' | 'created_at' | 'posted_on'>,
  _now: Date = new Date(),
): string | null {
  if (announcement.is_draft) return null
  if (announcement.posted_on != null) return postDateSchema.safeParse(announcement.posted_on).success ? announcement.posted_on : null
  const dateToUse = announcement.published_at ?? announcement.scheduled_for ?? announcement.created_at
  const date = new Date(dateToUse)
  if (Number.isNaN(date.getTime())) return null

  return formatInTimeZone(
    date,
    CLASSROOM_CALENDAR_TIMEZONE,
    'yyyy-MM-dd',
  )
}

/** A calendar reminder is a civil date, never an instant or an access cutoff. */
export function getCalendarTestDate(test: Pick<TestAssessment, 'test_date'>): string | null {
  const value = test.test_date
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null
}

/** Calendar placement is a civil day; legacy rows fall back to their release day. */
export function getCalendarMaterialDate(
  material: Pick<ClassworkMaterial, 'is_draft' | 'released_at' | 'created_at' | 'posted_on'>,
): string | null {
  if (material.is_draft) return null
  if (material.posted_on != null) return postDateSchema.safeParse(material.posted_on).success ? material.posted_on : null
  const date = new Date(material.released_at ?? material.created_at)
  return Number.isNaN(date.getTime()) ? null : formatInTimeZone(date, CLASSROOM_CALENDAR_TIMEZONE, 'yyyy-MM-dd')
}

export function isCalendarMaterialScheduled(
  material: Pick<ClassworkMaterial, 'is_draft' | 'released_at'>,
  now: Date = new Date(),
): boolean {
  return !material.is_draft && Boolean(material.released_at && new Date(material.released_at) > now)
}
