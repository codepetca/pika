import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  formatDateInToronto,
  formatRelativeDateTimeInToronto,
  getTodayInToronto,
  isOnTime,
  nowInToronto,
} from '@/lib/timezone'

describe('timezone utilities', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  describe('isOnTime', () => {
    it('should return true when submitted before midnight on the same day', () => {
      // November 15, 2024 at 11:59 PM Toronto time (UTC-5)
      const updatedAt = new Date('2024-11-15T23:59:00-05:00')
      const dateString = '2024-11-15'

      expect(isOnTime(updatedAt, dateString)).toBe(true)
    })

    it('should return true when submitted at 10pm on the same day', () => {
      // November 15, 2024 at 10:00 PM Toronto time
      const updatedAt = new Date('2024-11-15T22:00:00-05:00')
      const dateString = '2024-11-15'

      expect(isOnTime(updatedAt, dateString)).toBe(true)
    })

    it('should return false when submitted exactly at midnight', () => {
      // November 16, 2024 at 12:00 AM (midnight) Toronto time
      const updatedAt = new Date('2024-11-16T00:00:00-05:00')
      const dateString = '2024-11-15'

      expect(isOnTime(updatedAt, dateString)).toBe(false)
    })

    it('should return false when submitted after midnight', () => {
      // November 16, 2024 at 12:01 AM Toronto time
      const updatedAt = new Date('2024-11-16T00:01:00-05:00')
      const dateString = '2024-11-15'

      expect(isOnTime(updatedAt, dateString)).toBe(false)
    })

    it('should return false when submitted the next day', () => {
      // November 16, 2024 at 9:00 AM Toronto time
      const updatedAt = new Date('2024-11-16T09:00:00-05:00')
      const dateString = '2024-11-15'

      expect(isOnTime(updatedAt, dateString)).toBe(false)
    })

    it('should handle daylight saving time transitions', () => {
      // During DST (summer) - Toronto is UTC-4
      const summerUpdatedAt = new Date('2024-07-15T22:00:00-04:00')
      expect(isOnTime(summerUpdatedAt, '2024-07-15')).toBe(true)

      // During standard time (winter) - Toronto is UTC-5
      const winterUpdatedAt = new Date('2024-12-15T22:00:00-05:00')
      expect(isOnTime(winterUpdatedAt, '2024-12-15')).toBe(true)
    })
  })

  describe('formatDateInToronto', () => {
    it('should format date as YYYY-MM-DD', () => {
      const date = new Date('2024-11-15T15:30:00Z')
      const formatted = formatDateInToronto(date)

      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('should handle dates correctly across timezone boundaries', () => {
      // Late night UTC might be different day in Toronto
      const lateUTC = new Date('2024-11-16T02:00:00Z') // 2am UTC on Nov 16
      const formatted = formatDateInToronto(lateUTC)

      // In Toronto (UTC-5), this would still be Nov 15
      expect(formatted).toBe('2024-11-15')
    })
  })

  describe('nowInToronto / getTodayInToronto', () => {
    it('should return today in Toronto based on current time', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-11-16T03:00:00Z')) // 2024-11-15 22:00 in Toronto (UTC-5)

      const now = nowInToronto()
      expect(now).toBeInstanceOf(Date)
      expect(getTodayInToronto()).toBe('2024-11-15')
    })

    it('should return the Toronto date on a UTC host without double-converting', () => {
      vi.stubEnv('TZ', 'UTC')
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2024-11-16T05:30:00Z')) // 2024-11-16 00:30 in Toronto (UTC-5)

      expect(getTodayInToronto()).toBe('2024-11-16')
    })
  })

  describe('formatRelativeDateTimeInToronto', () => {
    const referenceDate = new Date('2026-06-25T16:00:00.000Z') // Thu Jun 25, noon in Toronto

    it('uses Today for the current Toronto calendar day', () => {
      expect(formatRelativeDateTimeInToronto('2026-06-25T14:36:00.000Z', referenceDate))
        .toBe('Today 10:36 AM')
    })

    it('uses Yesterday for the previous Toronto calendar day', () => {
      expect(formatRelativeDateTimeInToronto('2026-06-24T15:34:00.000Z', referenceDate))
        .toBe('Yesterday 11:34 AM')
    })

    it('uses a compact weekday, date, and time for older timestamps', () => {
      expect(formatRelativeDateTimeInToronto('2026-06-23T12:21:00.000Z', referenceDate))
        .toBe('Tue Jun 23 8:21 AM')
    })

    it('uses Toronto calendar days across daylight-saving transitions', () => {
      const afterFallback = new Date('2026-11-02T05:00:00.000Z') // Nov 2, midnight EST

      expect(formatRelativeDateTimeInToronto('2026-11-01T05:30:00.000Z', afterFallback))
        .toBe('Yesterday 1:30 AM')
    })
  })
})
