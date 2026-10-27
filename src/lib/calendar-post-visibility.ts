import { getCalendarAnnouncementDate, getCalendarMaterialDate } from '@/lib/calendar-items'
import type { Announcement, ClassworkMaterial } from '@/types'

type CalendarAnnouncement = Pick<Announcement, 'is_draft' | 'published_at' | 'scheduled_for' | 'created_at'> & { posted_on?: string | null }
type CalendarMaterial = Pick<ClassworkMaterial, 'is_draft' | 'released_at' | 'created_at'> & { posted_on?: string | null }

/** Undefined means the server's calendar horizon has not been confirmed. */
type CalendarPostHorizon = string | null | undefined

function withinHorizon(date: string | null, maxDate: CalendarPostHorizon): boolean {
  return maxDate !== undefined && date !== null && (maxDate === null || date <= maxDate)
}

/** Calendar placement never changes publication eligibility or the student's list access. */
export function filterCalendarAnnouncements<T extends CalendarAnnouncement>(
  announcements: T[], maxDate: CalendarPostHorizon, now: Date = new Date(),
): T[] {
  return announcements.filter(announcement => !announcement.is_draft
    && (!announcement.scheduled_for || Date.parse(announcement.scheduled_for) <= now.getTime())
    && withinHorizon(getCalendarAnnouncementDate(announcement), maxDate))
}

export function filterCalendarMaterials<T extends CalendarMaterial>(
  materials: T[], maxDate: CalendarPostHorizon, now: Date = new Date(),
): T[] {
  return materials.filter(material => !material.is_draft
    && (!material.released_at || Date.parse(material.released_at) <= now.getTime())
    && withinHorizon(getCalendarMaterialDate(material), maxDate))
}
