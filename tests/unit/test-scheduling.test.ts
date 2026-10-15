import { afterEach, describe, expect, it, vi } from 'vitest'
import { isTestScheduledForFuture } from '@/lib/test-scheduling'
import { getTodayInToronto } from '@/lib/timezone'

describe('student scheduled Test visibility', () => {
  afterEach(() => vi.useRealTimers())
  const scheduled = { status: 'closed', test_date: '2026-10-20', student_status: 'not_started', effective_access: 'closed' } as const

  it('hides a future closed Test until its Toronto calendar day', () => {
    expect(isTestScheduledForFuture(scheduled, '2026-10-19')).toBe(true)
    expect(isTestScheduledForFuture(scheduled, '2026-10-20')).toBe(false)
    expect(isTestScheduledForFuture(scheduled, '2026-10-21')).toBe(false)
  })

  it('preserves undated Tests, manual open access and existing student work', () => {
    for (const patch of [
      { test_date: null }, { test_date: undefined }, { status: 'active' },
      { effective_access: 'open' }, { student_status: 'responded' }, { student_status: 'can_view_results' },
    ]) expect(isTestScheduledForFuture({ ...scheduled, ...patch }, '2026-10-19')).toBe(false)
  })

  it('uses Toronto day boundaries rather than the UTC day', () => {
    const beforeMidnight = new Date('2026-10-20T03:59:59Z')
    const afterMidnight = new Date('2026-10-20T04:00:00Z')
    vi.useFakeTimers()
    vi.setSystemTime(beforeMidnight)
    expect(isTestScheduledForFuture(scheduled, getTodayInToronto())).toBe(true)
    vi.setSystemTime(afterMidnight)
    expect(isTestScheduledForFuture(scheduled, getTodayInToronto())).toBe(false)
  })
})
