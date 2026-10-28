import { describe, expect, it } from 'vitest'
import { materialPostDateSchema } from '@/lib/validations/material-post-date'

describe('calendar post date validation', () => {
  it.each(['0001-01-01', '2024-02-29', '2026-10-27', '2099-01-01', '9999-12-31'])('accepts past and future civil date %s', date => {
    expect(materialPostDateSchema.parse(date)).toBe(date)
  })
  it.each(['', '0000-01-01', '2026-02-29', '2026-02-30', '2026-1-01', '2026-10-27T12:00:00Z'])('rejects invalid date %s', date => {
    expect(materialPostDateSchema.safeParse(date).success).toBe(false)
  })
})
