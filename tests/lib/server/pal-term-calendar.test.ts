import { describe, expect, it } from 'vitest'

import {
  PAL_TERM_TIMEZONE,
  palTermCalendarForPeriodStart,
} from '@/lib/server/pal-term-calendar'

describe('Pal academic term calendar', () => {
  it('maps a Toronto weekly period to a stable adaptive fall term', () => {
    expect(palTermCalendarForPeriodStart('2026-09-14')).toEqual({
      termIdentity: 'pika-term:2026-08-31:2027-01-31:America/Toronto',
      termStartDay: '2026-08-31',
      termEndDay: '2027-01-31',
      termTimezone: PAL_TERM_TIMEZONE,
      termWeekCount: 22,
      weekStartDay: '2026-09-14',
      weekIndex: 3,
    })
  })

  it('keeps the short summer term inside Pal adaptive bounds', () => {
    expect(palTermCalendarForPeriodStart('2026-08-17')).toMatchObject({
      termStartDay: '2026-06-29',
      termEndDay: '2026-08-30',
      termWeekCount: 9,
      weekStartDay: '2026-08-17',
      weekIndex: 8,
    })
  })

  it('assigns each boundary week to exactly one term', () => {
    expect(palTermCalendarForPeriodStart('2026-08-24')).toMatchObject({
      termStartDay: '2026-06-29',
      weekIndex: 9,
    })
    expect(palTermCalendarForPeriodStart('2026-08-31')).toMatchObject({
      termStartDay: '2026-08-31',
      weekIndex: 1,
    })
  })

  it('rejects malformed or non-Monday period starts', () => {
    expect(() => palTermCalendarForPeriodStart('2026-02-30'))
      .toThrow('real Monday calendar day')
    expect(() => palTermCalendarForPeriodStart('2026-09-15'))
      .toThrow('real Monday calendar day')
  })
})
