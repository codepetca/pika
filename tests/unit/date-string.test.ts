import { describe, it, expect } from 'vitest'
import { addDaysToDateString } from '@/lib/date-string'

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

