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

  it('returns yesterday for the previous calendar day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T13:00:00.000Z')) // 2026-03-01 08:00 Toronto

    expect(getRelativeDueDate('2026-02-28')).toEqual({ text: 'yesterday', isPast: true })
  })

  it('returns relative day counts beyond tomorrow/yesterday', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T13:00:00.000Z')) // 2026-03-01 08:00 Toronto

    expect(getRelativeDueDate('2026-03-04')).toEqual({ text: 'in 3 days', isPast: false })
    expect(getRelativeDueDate('2026-02-20')).toEqual({ text: '9 days ago', isPast: true })
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

  it('returns null for invalid due dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-01T13:00:00.000Z')) // 2026-03-01 08:00 Toronto

    expect(getRelativeDueDate('not-a-date')).toBeNull()
    expect(getRelativeDueDate('2026-02-30')).toBeNull()
    expect(
      getRelativeDueDate('nope', [{ date: '2026-03-02', is_class_day: true }])
    ).toBeNull()
  })
})
