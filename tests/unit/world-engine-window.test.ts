import { describe, expect, it } from 'vitest'
import { getTorontoWeekWindow } from '@/lib/server/world-engine'

describe('getTorontoWeekWindow', () => {
  it('excludes current Friday when evaluating on Friday morning', () => {
    // Friday Feb 13, 2026 05:00 Toronto
    const now = new Date('2026-02-13T10:00:00.000Z')
    const window = getTorontoWeekWindow(now)

    expect(window).toEqual({
      start: '2026-02-06',
      end: '2026-02-12',
    })
  })

  it('includes Friday in the following week window (next Friday run)', () => {
    // Friday Feb 20, 2026 05:00 Toronto
    const now = new Date('2026-02-20T10:00:00.000Z')
    const window = getTorontoWeekWindow(now)

    expect(window).toEqual({
      start: '2026-02-13',
      end: '2026-02-19',
    })
  })
})
