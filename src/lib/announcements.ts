import { formatInTimeZone } from 'date-fns-tz'

export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 60
const ANNOUNCEMENT_TIMEZONE = 'America/Toronto'

export type AnnouncementTitleInputResult =
  | { ok: true; value: string | null | undefined }
  | { ok: false; error: string }

export function normalizeAnnouncementTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

export function parseAnnouncementTitleInput(value: unknown): AnnouncementTitleInputResult {
  if (value === undefined) return { ok: true, value: undefined }
  if (value === null) return { ok: true, value: null }
  if (typeof value !== 'string') {
    return { ok: false, error: 'Title must be text' }
  }

  const title = normalizeAnnouncementTitle(value)
  if (title && title.length > ANNOUNCEMENT_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Title must be ${ANNOUNCEMENT_TITLE_MAX_LENGTH} characters or fewer`,
    }
  }

  return { ok: true, value: title }
}

export function getAnnouncementCalendarLabel(
  announcement: { title?: string | null },
  scheduled: boolean,
): string {
  return normalizeAnnouncementTitle(announcement.title) ?? (scheduled ? 'Scheduled' : 'Announcement')
}

export function getAnnouncementPublicationTimestamp(
  announcement: {
    created_at: string
    published_at?: string | null
    scheduled_for?: string | null
  },
): string {
  return announcement.published_at ?? announcement.scheduled_for ?? announcement.created_at
}

export function sortAnnouncementsNewestFirst<T extends {
  created_at: string
  is_draft?: boolean
  published_at?: string | null
  scheduled_for?: string | null
  updated_at?: string
}>(
  announcements: readonly T[],
): T[] {
  return [...announcements].sort(
    (a, b) => {
      const aTimestamp = a.is_draft
        ? a.updated_at ?? a.created_at
        : getAnnouncementPublicationTimestamp(a)
      const bTimestamp = b.is_draft
        ? b.updated_at ?? b.created_at
        : getAnnouncementPublicationTimestamp(b)
      return new Date(bTimestamp).getTime() - new Date(aTimestamp).getTime()
    },
  )
}

export function formatAnnouncementTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return formatInTimeZone(date, ANNOUNCEMENT_TIMEZONE, 'EEE MMM d, h:mm a')
}
