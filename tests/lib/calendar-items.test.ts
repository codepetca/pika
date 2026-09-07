import { describe, expect, it } from 'vitest'
import {
  getCalendarAnnouncementDate,
  getCalendarAssignmentDate,
  isCalendarAnnouncementScheduled,
} from '@/lib/calendar-items'

describe('calendar item date mapping', () => {
  it('maps assignment due dates to the Toronto calendar date', () => {
    expect(getCalendarAssignmentDate({ due_at: '2026-05-12T03:00:00.000Z' })).toBe('2026-05-11')
  })

  it('uses a future announcement schedule date and a published creation date otherwise', () => {
    const now = new Date('2026-05-10T12:00:00.000Z')
    const scheduled = {
      scheduled_for: '2026-05-12T03:00:00.000Z',
      created_at: '2026-05-09T12:00:00.000Z',
    }
    const published = {
      scheduled_for: '2026-05-09T12:00:00.000Z',
      created_at: '2026-05-12T03:00:00.000Z',
    }

    expect(isCalendarAnnouncementScheduled(scheduled, now)).toBe(true)
    expect(getCalendarAnnouncementDate(scheduled, now)).toBe('2026-05-11')
    expect(isCalendarAnnouncementScheduled(published, now)).toBe(false)
    expect(getCalendarAnnouncementDate(published, now)).toBe('2026-05-11')
  })

  it('ignores malformed timestamps instead of breaking the calendar', () => {
    expect(getCalendarAssignmentDate({ due_at: 'not-a-date' })).toBeNull()
    expect(getCalendarAnnouncementDate({ scheduled_for: null, created_at: 'not-a-date' })).toBeNull()
  })
})
