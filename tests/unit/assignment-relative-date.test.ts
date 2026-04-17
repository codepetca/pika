import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRelativeDueDate } from '@/lib/assignment-relative-date'

describe('getRelativeDueDate', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns tomorrow for the next calendar day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T13:00:00.000Z')) // 2026-03-01 08:00 Toronto

    expect(getRelativeDueDate('2026-03-02')).toEqual({ text: 'tomorrow', isPast: false })
  })

  it('returns next class when class-day logic applies', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T13:00:00.000Z')) // 2026-03-01 08:00 Toronto

    expect(
      getRelativeDueDate('2026-03-03', [
        { date: '2026-03-02', is_class_day: false },
        { date: '2026-03-03', is_class_day: true },
      ])
    ).toEqual({ text: 'next class', isPast: false })
  })
})
