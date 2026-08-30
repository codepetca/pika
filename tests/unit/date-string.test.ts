import { describe, it, expect } from 'vitest'
import { addDaysToDateString, getPastRelativeDateLabel } from '@/lib/date-string'

describe('addDaysToDateString', () => {
  it('adds and subtracts days deterministically', () => {
    expect(addDaysToDateString('2025-01-01', 1)).toBe('2025-01-02')
    expect(addDaysToDateString('2025-01-01', -1)).toBe('2024-12-31')
  })

  it('throws on invalid input', () => {
    expect(() => addDaysToDateString('2025-1-1', 1)).toThrow()
    expect(() => addDaysToDateString('not-a-date', 1)).toThrow()
  })
})

describe('getPastRelativeDateLabel', () => {
  it.each([
    ['2026-05-06', 'Today'],
    ['2026-05-05', 'Yesterday'],
    ['2026-05-04', '2 days ago'],
    ['2026-04-30', '6 days ago'],
    ['2026-04-29', 'a week ago'],
    ['2026-04-22', '2 weeks ago'],
    ['2026-04-07', '4 weeks ago'],
    ['2026-04-06', '1 month ago'],
    ['2026-03-07', '2 months ago'],
    ['2025-05-06', '1 year ago'],
    ['2024-05-06', '2 years ago'],
  ])('formats %s as %s', (date, expected) => {
    expect(getPastRelativeDateLabel(date, '2026-05-06')).toBe(expected)
  })

  it('does not label forward or invalid dates', () => {
    expect(getPastRelativeDateLabel('2026-05-07', '2026-05-06')).toBeNull()
    expect(getPastRelativeDateLabel('not-a-date', '2026-05-06')).toBeNull()
  })
})
