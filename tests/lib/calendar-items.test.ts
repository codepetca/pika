import { describe, expect, it } from 'vitest'
import {
  getCalendarAnnouncementDate,
  getCalendarAssignmentDate,
  getCalendarTestDate,
  getCalendarMaterialDate,
  isCalendarMaterialScheduled,
  isCalendarAnnouncementScheduled,
} from '@/lib/calendar-items'

describe('calendar item date mapping', () => {
  it('maps assignment due dates to the Toronto calendar date', () => {
    expect(getCalendarAssignmentDate({ due_at: '2026-05-12T03:00:00.000Z' })).toBe('2026-05-11')
  })

  it('keeps announcements on their publication date after a schedule passes', () => {
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
    expect(getCalendarAnnouncementDate(published, now)).toBe('2026-05-09')
  })

  it('does not place drafts on the calendar', () => {
    expect(getCalendarAnnouncementDate({
      is_draft: true,
      published_at: null,
      scheduled_for: null,
      created_at: '2026-05-12T03:00:00.000Z',
    })).toBeNull()
  })

  it('ignores malformed timestamps instead of breaking the calendar', () => {
    expect(getCalendarAssignmentDate({ due_at: 'not-a-date' })).toBeNull()
    expect(getCalendarAnnouncementDate({ scheduled_for: null, created_at: 'not-a-date' })).toBeNull()
  })
})

describe('test reminder date mapping', () => {
  it.each(['2026-03-08', '2026-11-01', '2024-02-29'])('preserves civil date %s without a Toronto conversion', (test_date) => {
    expect(getCalendarTestDate({ test_date })).toBe(test_date)
  })
  it.each([null, undefined, '', '2026-02-29', '2026-02-30', '2026-13-01', '2026-1-01', '2026-03-08T00:00:00Z'])('omits absent or invalid date %s', (test_date) => {
    expect(getCalendarTestDate({ test_date })).toBeNull()
  })
})


describe('material publication date mapping', () => {
  it('uses the Toronto release date without treating it as a due date', () => {
    expect(getCalendarMaterialDate({ is_draft: false, released_at: '2026-05-12T03:00:00Z', created_at: '2026-05-01T12:00:00Z' })).toBe('2026-05-11')
  })
  it('omits drafts and malformed dates, and supports legacy published rows', () => {
    expect(getCalendarMaterialDate({ is_draft: true, released_at: '2026-05-12T03:00:00Z', created_at: '2026-05-01T12:00:00Z' })).toBeNull()
    expect(getCalendarMaterialDate({ is_draft: false, released_at: 'invalid', created_at: '2026-05-01T12:00:00Z' })).toBeNull()
    expect(getCalendarMaterialDate({ is_draft: false, released_at: null, created_at: '2026-05-01T12:00:00Z' })).toBe('2026-05-01')
  })
  it('distinguishes future release from published material', () => {
    const now = new Date('2026-05-10T12:00:00Z')
    expect(isCalendarMaterialScheduled({ is_draft: false, released_at: '2026-05-12T12:00:00Z' }, now)).toBe(true)
    expect(isCalendarMaterialScheduled({ is_draft: false, released_at: '2026-05-10T12:00:00Z' }, now)).toBe(false)
    expect(isCalendarMaterialScheduled({ is_draft: true, released_at: '2026-05-12T12:00:00Z' }, now)).toBe(false)
  })
})
