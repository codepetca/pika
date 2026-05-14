export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 60

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

export function sortAnnouncementsNewestFirst<T extends { created_at: string }>(
  announcements: readonly T[],
): T[] {
  return [...announcements].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )
}
