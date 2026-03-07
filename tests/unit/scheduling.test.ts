import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  combineScheduleDateTimeToIso,
  getTodayInSchedulingTimezone,
  isScheduleIsoInFuture,
  isVisibleAtNow,
  parseScheduleIsoToParts,
} from '@/lib/scheduling'

describe('scheduling utilities', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('combines Toronto date and time into UTC ISO', () => {
    const iso = combineScheduleDateTimeToIso('2026-03-01', '08:30')
    expect(iso).toBe('2026-03-01T13:30:00.000Z')
  })

  it('parses schedule ISO into Toronto date/time parts', () => {
    const parts = parseScheduleIsoToParts('2026-03-01T13:30:00.000Z')
    expect(parts).toEqual({ date: '2026-03-01', time: '08:30' })
  })

  it('detects if schedule is in the future', () => {
    const now = new Date('2026-03-01T13:00:00.000Z')
    expect(isScheduleIsoInFuture('2026-03-01T13:30:00.000Z', now)).toBe(true)
    expect(isScheduleIsoInFuture('2026-03-01T12:59:59.000Z', now)).toBe(false)
  })

  it('treats null schedule as visible and future schedule as hidden', () => {
    const now = new Date('2026-03-01T13:00:00.000Z')
    expect(isVisibleAtNow(null, now)).toBe(true)
    expect(isVisibleAtNow('2026-03-01T12:59:59.000Z', now)).toBe(true)
    expect(isVisibleAtNow('2026-03-01T13:30:00.000Z', now)).toBe(false)
  })

  it('returns Toronto date for now helper', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T04:30:00.000Z')) // 2026-02-28 23:30 Toronto
    expect(getTodayInSchedulingTimezone()).toBe('2026-02-28')
  })
})

