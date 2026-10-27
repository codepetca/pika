import { afterEach, describe, expect, it, vi } from 'vitest'
import { materialPostDateSchema } from '@/lib/validations/material-post-date'
import { getPostDateUpdate } from '@/lib/post-date'
import { postDateInputSchema } from '@/lib/validations/post-date'

describe('material post date validation', () => {
  afterEach(() => vi.useRealTimers())

  it('uses the Toronto day when UTC has already reached tomorrow', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-23T02:00:00Z'))
    expect(materialPostDateSchema.safeParse('2026-10-22').success).toBe(true)
    expect(materialPostDateSchema.safeParse('2026-10-21').success).toBe(true)
    expect(materialPostDateSchema.safeParse('2026-10-23').success).toBe(false)
  })

  it('accepts today immediately after Toronto midnight during standard time', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-11-02T05:00:00Z'))
    expect(materialPostDateSchema.safeParse('2026-11-02').success).toBe(true)
    expect(materialPostDateSchema.safeParse('2026-11-03').success).toBe(false)
  })

  it('routes by the Toronto day and leaves the backdating API contract intact', () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-23T02:00:00Z'))
    expect(getPostDateUpdate('2026-10-22')).toEqual({ posted_on: '2026-10-22' })
    expect(getPostDateUpdate('2026-10-21')).toEqual({ posted_on: '2026-10-21' })
    expect(getPostDateUpdate('2026-10-23')).toEqual({ scheduled_for: '2026-10-23T04:00:00.000Z' })
    expect(materialPostDateSchema.safeParse('2026-10-23').success).toBe(false)
  })

  it.each([
    ['2027-03-14', '2027-03-14T05:00:00.000Z'],
    ['2027-03-15', '2027-03-15T04:00:00.000Z'],
    ['2027-11-07', '2027-11-07T04:00:00.000Z'],
    ['2027-11-08', '2027-11-08T05:00:00.000Z'],
  ])('schedules Toronto midnight across DST: %s', (date, scheduled_for) => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-26T12:00:00Z'))
    expect(getPostDateUpdate(date)).toEqual({ scheduled_for })
  })

  it.each(['', '0000-01-01', '2027-02-29', '2026-02-30', '2026-1-01', '2026-10-26T12:00:00Z'])('rejects invalid editor dates: %s', date => {
    expect(postDateInputSchema.safeParse(date).success).toBe(false)
    expect(() => getPostDateUpdate(date)).toThrow()
  })
})
