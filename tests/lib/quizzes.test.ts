import { describe, it, expect } from 'vitest'
import {
  getStudentAssessmentStatus,
  getStudentQuizStatus,
  getStudentTestStatus,
} from '@/lib/quizzes'

describe('getStudentAssessmentStatus', () => {
  it('returns not_started when hasResponded is false', () => {
    expect(getStudentAssessmentStatus({ status: 'active' }, false)).toBe('not_started')
  })

  it('returns not_started when not responded even if closed with show_results', () => {
    expect(
      getStudentAssessmentStatus({ status: 'closed', show_results: true }, false)
    ).toBe('not_started')
  })

  it('returns responded when responded to an active assessment', () => {
    expect(getStudentAssessmentStatus({ status: 'active' }, true)).toBe('responded')
  })

  it('returns responded when responded to closed assessment with no show_results and no returnedAt', () => {
    expect(
      getStudentAssessmentStatus({ status: 'closed', show_results: false }, true)
    ).toBe('responded')
  })

  // Quiz-style: show_results flag
  it('returns can_view_results when closed and show_results is true', () => {
    expect(
      getStudentAssessmentStatus({ status: 'closed', show_results: true }, true)
    ).toBe('can_view_results')
  })

  it('does NOT return can_view_results when active even if show_results is true', () => {
    expect(
      getStudentAssessmentStatus({ status: 'active', show_results: true }, true)
    ).toBe('responded')
  })

  // Test-style: returnedAt flag
  it('returns can_view_results when closed and returnedAt is a date string', () => {
    expect(
      getStudentAssessmentStatus({ status: 'closed' }, true, { returnedAt: '2024-01-01T00:00:00Z' })
    ).toBe('can_view_results')
  })

  it('returns responded when closed but returnedAt is null', () => {
    expect(
      getStudentAssessmentStatus({ status: 'closed' }, true, { returnedAt: null })
    ).toBe('responded')
  })

  it('returns responded when closed but returnedAt is false', () => {
    expect(
      getStudentAssessmentStatus({ status: 'closed' }, true, { returnedAt: false })
    ).toBe('responded')
  })

  it('does NOT return can_view_results when active even if returnedAt is set', () => {
    expect(
      getStudentAssessmentStatus({ status: 'active' }, true, { returnedAt: '2024-01-01' })
    ).toBe('responded')
  })

  it('returnedAt takes precedence over show_results when both present', () => {
    // Both conditions met → can_view_results
    expect(
      getStudentAssessmentStatus(
        { status: 'closed', show_results: true },
        true,
        { returnedAt: '2024-01-01T00:00:00Z' }
      )
    ).toBe('can_view_results')
  })

  it('handles undefined opts', () => {
    expect(getStudentAssessmentStatus({ status: 'closed', show_results: false }, true, undefined)).toBe(
      'responded'
    )
  })
})

describe('getStudentQuizStatus (thin wrapper)', () => {
  it('delegates to getStudentAssessmentStatus — not_started when not responded', () => {
    expect(getStudentQuizStatus({ status: 'active', show_results: false }, false)).toBe('not_started')
  })

  it('returns responded when responded but quiz is still active', () => {
    expect(getStudentQuizStatus({ status: 'active', show_results: true }, true)).toBe('responded')
  })

  it('returns can_view_results when closed and show_results is true', () => {
    expect(getStudentQuizStatus({ status: 'closed', show_results: true }, true)).toBe('can_view_results')
  })

  it('returns responded when closed but show_results is false', () => {
    expect(getStudentQuizStatus({ status: 'closed', show_results: false }, true)).toBe('responded')
  })
})

describe('getStudentTestStatus (thin wrapper)', () => {
  it('delegates to getStudentAssessmentStatus — not_started when not responded', () => {
    expect(getStudentTestStatus({ status: 'active' }, false, null)).toBe('not_started')
  })

  it('returns responded when responded but not yet returned by teacher', () => {
    expect(getStudentTestStatus({ status: 'closed' }, true, null)).toBe('responded')
  })

  it('returns can_view_results when teacher has returned the work (date string)', () => {
    expect(getStudentTestStatus({ status: 'closed' }, true, '2024-01-01T00:00:00Z')).toBe(
      'can_view_results'
    )
  })

  it('accepts boolean true for returnedAt', () => {
    expect(getStudentTestStatus({ status: 'closed' }, true, true)).toBe('can_view_results')
  })

  it('accepts boolean false for returnedAt', () => {
    expect(getStudentTestStatus({ status: 'closed' }, true, false)).toBe('responded')
  })

  it('returns responded when active even if returnedAt is set', () => {
    expect(getStudentTestStatus({ status: 'active' }, true, '2024-01-01T00:00:00Z')).toBe('responded')
  })
})
