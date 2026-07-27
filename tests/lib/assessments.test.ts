import { describe, it, expect } from 'vitest'
import {
  getStudentAssessmentStatus,
  getStudentTestStatus,
} from '@/lib/assessments'

describe('getStudentAssessmentStatus', () => {
  it('returns not_started when hasResponded is false', () => {
    expect(getStudentAssessmentStatus({ status: 'active' }, false)).toBe('not_started')
  })

  it('returns responded when responded to an active assessment', () => {
    expect(getStudentAssessmentStatus({ status: 'active' }, true)).toBe('responded')
  })

  it('returns responded when responded to closed test with no returnedAt', () => {
    expect(getStudentAssessmentStatus({ status: 'closed' }, true)).toBe('responded')
  })

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

  it('handles undefined opts', () => {
    expect(getStudentAssessmentStatus({ status: 'closed' }, true, undefined)).toBe(
      'responded'
    )
  })
})

describe('getStudentTestStatus (thin wrapper)', () => {
  it('delegates to getStudentAssessmentStatus - not_started when not responded', () => {
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
