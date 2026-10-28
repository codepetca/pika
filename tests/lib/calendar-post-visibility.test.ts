import { describe, expect, it } from 'vitest'
import { filterCalendarAnnouncements, filterCalendarMaterials } from '@/lib/calendar-post-visibility'

const now = new Date('2026-10-27T16:00:00Z')
const announcement = { id: 'announcement', is_draft: false, posted_on: '2026-10-30', published_at: '2026-10-27T12:00:00Z', scheduled_for: null, created_at: '2026-10-27T12:00:00Z' }
const material = { id: 'material', is_draft: false, posted_on: '2026-10-30', released_at: '2026-10-27T12:00:00Z', created_at: '2026-10-27T12:00:00Z' }

describe('student calendar post visibility', () => {
  it('keeps immediately published future placements within the inclusive horizon', () => {
    expect(filterCalendarAnnouncements([announcement], '2026-10-30', now)).toEqual([announcement])
    expect(filterCalendarMaterials([material], '2026-10-30', now)).toEqual([material])
  })

  it('omits placements beyond the horizon regardless of release eligibility', () => {
    expect(filterCalendarAnnouncements([announcement], '2026-10-29', now)).toEqual([])
    expect(filterCalendarMaterials([material], '2026-10-29', now)).toEqual([])
  })

  it('fails closed for an unconfirmed horizon and permits null as unrestricted', () => {
    expect(filterCalendarAnnouncements([announcement], undefined, now)).toEqual([])
    expect(filterCalendarMaterials([material], undefined, now)).toEqual([])
    expect(filterCalendarAnnouncements([announcement], null, now)).toEqual([announcement])
    expect(filterCalendarMaterials([material], null, now)).toEqual([material])
  })

  it('keeps release scheduling and draft exclusion separate from calendar placement', () => {
    expect(filterCalendarAnnouncements([
      { ...announcement, scheduled_for: '2026-10-28T12:00:00Z' },
      { ...announcement, is_draft: true },
    ], null, now)).toEqual([])
    expect(filterCalendarMaterials([
      { ...material, released_at: '2026-10-28T12:00:00Z' },
      { ...material, is_draft: true },
    ], null, now)).toEqual([])
  })
})
