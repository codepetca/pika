import { describe, expect, it } from 'vitest'
import {
  ANNOUNCEMENT_TITLE_MAX_LENGTH,
  formatAnnouncementTimestamp,
  getAnnouncementCalendarLabel,
  normalizeAnnouncementTitle,
  parseAnnouncementTitleInput,
  sortAnnouncementsNewestFirst,
} from '@/lib/announcements'

describe('announcement helpers', () => {
  it('normalizes blank announcement titles to null', () => {
    expect(normalizeAnnouncementTitle('  Test reminder  ')).toBe('Test reminder')
    expect(normalizeAnnouncementTitle('   ')).toBeNull()
    expect(normalizeAnnouncementTitle(null)).toBeNull()
  })

  it('validates optional announcement title input', () => {
    expect(parseAnnouncementTitleInput(undefined)).toEqual({ ok: true, value: undefined })
    expect(parseAnnouncementTitleInput(null)).toEqual({ ok: true, value: null })
    expect(parseAnnouncementTitleInput(' Calendar note ')).toEqual({ ok: true, value: 'Calendar note' })
    expect(parseAnnouncementTitleInput('a'.repeat(ANNOUNCEMENT_TITLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: `Title must be ${ANNOUNCEMENT_TITLE_MAX_LENGTH} characters or fewer`,
    })
  })

  it('uses the title for calendar labels before falling back to status labels', () => {
    expect(getAnnouncementCalendarLabel({ title: 'Materials due' }, false)).toBe('Materials due')
    expect(getAnnouncementCalendarLabel({ title: null }, false)).toBe('Announcement')
    expect(getAnnouncementCalendarLabel({ title: '  ' }, true)).toBe('Scheduled')
  })

  it('sorts announcements newest first by creation date', () => {
    const sorted = sortAnnouncementsNewestFirst([
      {
        id: 'older-scheduled',
        created_at: '2026-05-12T12:00:00.000Z',
        scheduled_for: '2026-05-20T12:00:00.000Z',
      },
      { id: 'newest', created_at: '2026-05-14T12:00:00.000Z', scheduled_for: null },
      { id: 'older', created_at: '2026-05-13T12:00:00.000Z', scheduled_for: null },
    ])

    expect(sorted.map((announcement) => announcement.id)).toEqual(['newest', 'older', 'older-scheduled'])
  })

  it('formats announcement timestamps in Toronto across standard and daylight time', () => {
    expect(formatAnnouncementTimestamp('2026-01-15T15:00:00.000Z')).toBe('Thu Jan 15, 10:00 AM')
    expect(formatAnnouncementTimestamp('2026-07-15T15:00:00.000Z')).toBe('Wed Jul 15, 11:00 AM')
  })

  it('returns an invalid timestamp unchanged', () => {
    expect(formatAnnouncementTimestamp('not-a-date')).toBe('not-a-date')
  })
})
