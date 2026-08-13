import { describe, expect, it } from 'vitest'
import { formatClassroomDateRange } from '@/lib/classroom-date-range'

describe('formatClassroomDateRange', () => {
  it('formats classroom dates as abbreviated month and year', () => {
    expect(formatClassroomDateRange('2025-09-02', '2026-01-30')).toBe(
      'Sept 2025 - Jan 2026',
    )
  })

  it('keeps first-of-month dates in their Toronto calendar month', () => {
    expect(formatClassroomDateRange('2025-09-01', '2026-01-01')).toBe(
      'Sept 2025 - Jan 2026',
    )
  })

  it('returns null when either date is missing or invalid', () => {
    expect(formatClassroomDateRange(null, '2026-01-30')).toBeNull()
    expect(formatClassroomDateRange('2025-09-02', undefined)).toBeNull()
    expect(formatClassroomDateRange('2025-02-30', '2026-01-30')).toBeNull()
  })
})
