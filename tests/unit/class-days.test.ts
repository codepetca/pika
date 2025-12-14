import { describe, it, expect } from 'vitest'
import type { ClassDay } from '@/types'
import { getMostRecentClassDayBefore, isClassDayOnDate } from '@/lib/class-days'

describe('class-days helpers', () => {
  const classDays: ClassDay[] = [
    { id: '1', classroom_id: 'c', date: '2025-01-01', is_class_day: true, prompt_text: null },
    { id: '2', classroom_id: 'c', date: '2025-01-02', is_class_day: false, prompt_text: null },
    { id: '3', classroom_id: 'c', date: '2025-01-03', is_class_day: true, prompt_text: null },
  ]

  it('detects class day on date', () => {
    expect(isClassDayOnDate(classDays, '2025-01-01')).toBe(true)
    expect(isClassDayOnDate(classDays, '2025-01-02')).toBe(false)
    expect(isClassDayOnDate(classDays, '2025-01-04')).toBe(false)
  })

  it('finds most recent class day strictly before a date', () => {
    expect(getMostRecentClassDayBefore(classDays, '2025-01-01')).toBe(null)
    expect(getMostRecentClassDayBefore(classDays, '2025-01-02')).toBe('2025-01-01')
    expect(getMostRecentClassDayBefore(classDays, '2025-01-04')).toBe('2025-01-03')
  })
})

