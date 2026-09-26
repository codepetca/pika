import { describe, expect, it } from 'vitest'
import { applyMaximumToCell, applyMaximumToColumn, previewMaximumChange } from '@/lib/gradebook-maximum'
import type { GradebookAssessmentColumn } from '@/types'
const column: GradebookAssessmentColumn = { assessment_type: 'test', assessment_id: 't1', title: 'Test', code: 'T1', possible: 100, weight: 10, include_in_final: true }
const cell = () => ({ assessment_type: 'test' as const, assessment_id: 't1', earned: 80, possible: 100, percent: 80, is_graded: true })
describe('maximum override display and calculation', () => {
  it('keeps earned marks while recalculating percentages', () => {
    const score = cell(); applyMaximumToCell(score, previewMaximumChange(column, 50, 'keep_marks'))
    expect(score).toMatchObject({ earned: 80, possible: 50, percent: 160 })
  })
  it('preserves percentages by rescaling earned marks and calculated undo marks', () => {
    const score = { ...cell(), is_manual_override: true, calculated_earned: 70 }
    applyMaximumToCell(score, previewMaximumChange(column, 50, 'preserve_percentages'))
    expect(score).toMatchObject({ earned: 40, possible: 50, percent: 80, calculated_earned: 35 })
  })
  it('uses the current maximum for subsequent changes', () => {
    const displayed = { ...column }; applyMaximumToColumn(displayed, previewMaximumChange(column, 50, 'preserve_percentages'))
    const next = previewMaximumChange(displayed, 25, 'keep_marks')
    const score = cell(); applyMaximumToCell(score, next)
    expect(score).toMatchObject({ earned: 40, possible: 25, percent: 160 })
    expect(displayed).toMatchObject({ source_possible: 100, possible: 50, is_maximum_override: true })
  })
  it('retains zeroes and missing marks', () => {
    const state = previewMaximumChange(column, 50, 'preserve_percentages')
    const zero = { ...cell(), earned: 0, percent: 0 }; applyMaximumToCell(zero, state)
    expect(zero.earned).toBe(0); expect(zero.percent).toBe(0)
    const blank = { ...cell(), earned: null, percent: null, is_graded: false }; applyMaximumToCell(blank, state)
    expect(blank).toMatchObject({ earned: null, percent: null, is_graded: false, possible: 50 })
  })
})
