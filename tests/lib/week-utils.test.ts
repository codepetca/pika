import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  getWeekStartForDate,
  getWeekDays,
  canStudentViewWeek,
  getCurrentWeekStart,
  getNextWeekStart,
  getPreviousWeekStart,
} from '@/lib/week-utils'

describe('week-utils', () => {
  describe('getWeekStartForDate', () => {
    it('returns Monday for a Monday date', () => {
      expect(getWeekStartForDate('2026-01-12')).toBe('2026-01-12') // Monday
    })

    it('returns Monday for a Tuesday date', () => {
      expect(getWeekStartForDate('2026-01-13')).toBe('2026-01-12') // Tuesday -> Monday
    })

    it('returns Monday for a Wednesday date', () => {
      expect(getWeekStartForDate('2026-01-14')).toBe('2026-01-12')
    })

    it('returns Monday for a Thursday date', () => {
      expect(getWeekStartForDate('2026-01-15')).toBe('2026-01-12')
    })

    it('returns Monday for a Friday date', () => {
      expect(getWeekStartForDate('2026-01-16')).toBe('2026-01-12')
    })

    it('returns Monday for a Saturday date', () => {
      expect(getWeekStartForDate('2026-01-17')).toBe('2026-01-12')
    })

    it('returns Monday for a Sunday date', () => {
      expect(getWeekStartForDate('2026-01-18')).toBe('2026-01-12')
    })

    it('handles year boundaries correctly', () => {
      // Dec 31, 2025 is a Wednesday, Monday is Dec 29, 2025
      expect(getWeekStartForDate('2025-12-31')).toBe('2025-12-29')
    })

    it('handles week crossing year boundary', () => {
      // Jan 1, 2026 is a Thursday, Monday is Dec 29, 2025
      expect(getWeekStartForDate('2026-01-01')).toBe('2025-12-29')
    })
  })

  describe('getWeekDays', () => {
    it('returns Mon-Fri for a week starting Monday', () => {
      const days = getWeekDays('2026-01-12')
      expect(days).toEqual([
        '2026-01-12', // Monday
        '2026-01-13', // Tuesday
        '2026-01-14', // Wednesday
        '2026-01-15', // Thursday
        '2026-01-16', // Friday
      ])
    })

    it('returns 5 days', () => {
      const days = getWeekDays('2026-01-12')
      expect(days).toHaveLength(5)
    })

    it('handles year boundary weeks', () => {
      const days = getWeekDays('2025-12-29')
      expect(days).toEqual([
        '2025-12-29', // Monday
        '2025-12-30', // Tuesday
        '2025-12-31', // Wednesday
        '2026-01-01', // Thursday
        '2026-01-02', // Friday
      ])
    })
  })

  describe('getNextWeekStart', () => {
    it('returns the following Monday', () => {
      expect(getNextWeekStart('2026-01-12')).toBe('2026-01-19')
    })

    it('handles year boundary', () => {
      expect(getNextWeekStart('2025-12-29')).toBe('2026-01-05')
    })
  })

  describe('getPreviousWeekStart', () => {
    it('returns the previous Monday', () => {
      expect(getPreviousWeekStart('2026-01-12')).toBe('2026-01-05')
    })

    it('handles year boundary', () => {
      expect(getPreviousWeekStart('2026-01-05')).toBe('2025-12-29')
    })
  })

  describe('getCurrentWeekStart', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('returns Monday of current week in Toronto timezone', () => {
      // Set time to Wednesday Jan 14, 2026 at 10am Toronto time
      // Toronto is UTC-5 in winter, so 10am Toronto = 3pm UTC
      vi.setSystemTime(new Date('2026-01-14T15:00:00Z'))
      expect(getCurrentWeekStart()).toBe('2026-01-12')
    })

    it('handles late night correctly (still same day in Toronto)', () => {
      // 11pm Toronto on Wednesday = 4am UTC Thursday
      vi.setSystemTime(new Date('2026-01-15T04:00:00Z'))
      expect(getCurrentWeekStart()).toBe('2026-01-12')
    })
  })

  describe('canStudentViewWeek', () => {
    const currentWeekStart = '2026-01-12'
    const nextWeekStart = '2026-01-19'
    const twoWeeksAhead = '2026-01-26'
    const previousWeek = '2026-01-05'

    describe('visibility: current', () => {
      it('allows current week', () => {
        expect(canStudentViewWeek(currentWeekStart, 'current', currentWeekStart)).toBe(true)
      })

      it('allows past weeks', () => {
        expect(canStudentViewWeek(previousWeek, 'current', currentWeekStart)).toBe(true)
      })

      it('denies next week', () => {
        expect(canStudentViewWeek(nextWeekStart, 'current', currentWeekStart)).toBe(false)
      })

      it('denies future weeks', () => {
        expect(canStudentViewWeek(twoWeeksAhead, 'current', currentWeekStart)).toBe(false)
      })
    })

    describe('visibility: next', () => {
      it('allows current week', () => {
        expect(canStudentViewWeek(currentWeekStart, 'next', currentWeekStart)).toBe(true)
      })

      it('allows past weeks', () => {
        expect(canStudentViewWeek(previousWeek, 'next', currentWeekStart)).toBe(true)
      })

      it('allows next week', () => {
        expect(canStudentViewWeek(nextWeekStart, 'next', currentWeekStart)).toBe(true)
      })

      it('denies two weeks ahead', () => {
        expect(canStudentViewWeek(twoWeeksAhead, 'next', currentWeekStart)).toBe(false)
      })
    })

    describe('visibility: all', () => {
      it('allows current week', () => {
        expect(canStudentViewWeek(currentWeekStart, 'all', currentWeekStart)).toBe(true)
      })

      it('allows past weeks', () => {
        expect(canStudentViewWeek(previousWeek, 'all', currentWeekStart)).toBe(true)
      })

      it('allows next week', () => {
        expect(canStudentViewWeek(nextWeekStart, 'all', currentWeekStart)).toBe(true)
      })

      it('allows far future weeks', () => {
        expect(canStudentViewWeek('2026-12-28', 'all', currentWeekStart)).toBe(true)
      })
    })
  })
})
