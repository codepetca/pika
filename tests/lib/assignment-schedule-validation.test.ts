import { describe, expect, it } from 'vitest'
import {
  ASSIGNMENT_SCHEDULE_DUE_DATE_ERROR,
  getScheduledReleaseDueDateError,
  isScheduledReleaseOnOrBeforeDueDate,
} from '@/lib/assignment-schedule-validation'

describe('assignment schedule validation', () => {
  it('allows scheduled release before the assignment due date', () => {
    expect(
      isScheduledReleaseOnOrBeforeDueDate(
        '2099-03-01T14:00:00.000Z',
        '2099-03-01T23:59:00.000Z'
      )
    ).toBe(true)
  })

  it('allows scheduled release exactly at the assignment due date', () => {
    expect(
      isScheduledReleaseOnOrBeforeDueDate(
        '2099-03-01T23:59:00.000Z',
        '2099-03-01T23:59:00.000Z'
      )
    ).toBe(true)
  })

  it('rejects scheduled release after the assignment due date', () => {
    expect(
      isScheduledReleaseOnOrBeforeDueDate(
        '2099-03-02T00:00:00.000Z',
        '2099-03-01T23:59:00.000Z'
      )
    ).toBe(false)
  })

  it('returns the canonical validation message for invalid date order', () => {
    expect(
      getScheduledReleaseDueDateError(
        '2099-03-02T00:00:00.000Z',
        '2099-03-01T23:59:00.000Z'
      )
    ).toBe(ASSIGNMENT_SCHEDULE_DUE_DATE_ERROR)
  })

  it('does not fail closed when one side is absent or malformed', () => {
    expect(isScheduledReleaseOnOrBeforeDueDate(null, '2099-03-01T23:59:00.000Z')).toBe(true)
    expect(isScheduledReleaseOnOrBeforeDueDate('not-a-date', '2099-03-01T23:59:00.000Z')).toBe(true)
  })
})
