import { describe, expect, it } from 'vitest'
import { formatAboveMaximumDescription, isAssessmentAboveMaximum, isGradeAboveMaximum } from '@/lib/gradebook-display'

describe('above-maximum display signal', () => {
  it('detects small overages that whole-percent display hides without flagging floating-point noise', () => {
    const cell = { assessment_type: 'assignment' as const, assessment_id: 'a1', earned: 100.0001, possible: 100, percent: 100, is_graded: true }
    expect(isAssessmentAboveMaximum(cell)).toBe(true)
    expect(isAssessmentAboveMaximum({ ...cell, earned: 100.00000000000001 })).toBe(false)
    expect(isAssessmentAboveMaximum({ ...cell, is_graded: false })).toBe(false)
    expect(isGradeAboveMaximum(Infinity)).toBe(false)
    expect(isGradeAboveMaximum(null)).toBe(false)
    expect(formatAboveMaximumDescription(100.0001)).toBe('Above maximum (100.0001%)')
  })
})
