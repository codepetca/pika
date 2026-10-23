import { afterEach, describe, expect, it, vi } from 'vitest'
import { materialPostDateSchema } from '@/lib/validations/material-post-date'

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
})
