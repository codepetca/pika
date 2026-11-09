import { describe, expect, it } from 'vitest'
import { buildGradebookStudentReport } from '@/lib/gradebook-report'
import type { GradebookAssessmentCell, GradebookAssessmentColumn, GradebookCategory, GradebookStudentSummary } from '@/types'

const categories: GradebookCategory[] = [
  { id: 'a', name: 'Term', percentage: 70, default_assessment_weight: 1, position: 0, is_default: true },
  { id: 'b', name: 'Final', percentage: 30, default_assessment_weight: 1, position: 1, is_default: false },
]
const column = (id: string, overrides: Partial<GradebookAssessmentColumn> = {}): GradebookAssessmentColumn => ({
  assessment_id: id, assessment_type: 'assignment', code: id, title: id, possible: 10,
  weight: 1, category_id: 'a', include_in_final: true, ...overrides,
})
const cell = (id: string, overrides: Partial<GradebookAssessmentCell> = {}): GradebookAssessmentCell => ({
  assessment_id: id, assessment_type: 'assignment', earned: 8, possible: 10, percent: 80,
  is_graded: true, returned_at: '2026-01-01', ...overrides,
})
const student: GradebookStudentSummary = {
  student_id: 'private-id', student_email: 'private@example.com', student_number: 'private-number',
  student_first_name: 'Alex', student_last_name: 'Example', assignments_earned: null, assignments_possible: null,
  assignments_percent: null, tests_earned: null, tests_possible: null, tests_percent: null,
  final_percent: 99, is_final_override: true, calculated_final_percent: 98,
}

describe('buildGradebookStudentReport', () => {
  it('shows one returned assessment when the other two graded assessments are not returned', () => {
    const columns = [column('Essay'), column('Letter'), column('Test', { assessment_type: 'test' })]
    const assessment_scores = [cell('Essay'), cell('Letter', { returned_at: null }), cell('Test', { assessment_type: 'test', returned_at: null })]
    const report = buildGradebookStudentReport({ student: { ...student, assessment_scores }, columns, categories })
    expect(report.items.map((item) => item.title)).toEqual(['Essay'])
    expect(report.currentPercent).toBe(80)
  })
  it('includes only returned complete work and saved standalone marks, without identity data', () => {
    const columns = [column('returned'), column('unreturned'), column('partial'), column('draft', { is_draft: true }),
      column('draft-test', { assessment_type: 'test', status: 'draft' }), column('saved', { assessment_type: 'item', category_id: 'b' })]
    const assessment_scores = [cell('returned'), cell('unreturned', { returned_at: null }), cell('partial', { is_graded: false }),
      cell('draft'), cell('draft-test', { assessment_type: 'test' }), cell('saved', { assessment_type: 'item', returned_at: null, earned: 5, percent: 50 })]
    const report = buildGradebookStudentReport({ student: { ...student, assessment_scores }, columns, categories })
    expect(report.items.map((item) => item.title)).toEqual(['returned', 'saved'])
    expect(report.currentPercent).toBe(71)
    expect(report.studentName).toBe('Alex Example')
    expect(JSON.stringify(report)).not.toMatch(/private|99|98/)
  })

  it('normalizes weights over scored categories and excludes zero-weight and excluded marks from the total', () => {
    const columns = [column('one', { weight: 1 }), column('two', { weight: 3 }), column('zero', { weight: 0 }), column('excluded', { include_in_final: false })]
    const assessment_scores = [cell('one', { earned: 10, percent: 100 }), cell('two', { earned: 0, percent: 0 }), cell('zero'), cell('excluded')]
    const report = buildGradebookStudentReport({ student: { ...student, assessment_scores }, columns, categories })
    expect(report.currentPercent).toBe(25)
    expect(report.items.map((item) => item.included)).toEqual([true, true, false, false])
    expect(report.items[2].isZeroWeight).toBe(true)
  })

  it('uses the source percentage when earned points have been rounded', () => {
    const report = buildGradebookStudentReport({ student: { ...student, assessment_scores: [cell('small', { earned: 0.53, possible: 1, percent: 53.33 })] }, columns: [column('small')], categories })
    expect(report.items[0].percent).toBe(53.33)
    expect(report.currentPercent).toBe(53.33)
  })

  it('calculates the current grade from unrounded points', () => {
    const columns = [column('one'), column('two', { weight: 2 })]
    const assessment_scores = [cell('one', { earned: 0, possible: 1, percent: 0, calculation_earned: 0 }),
      cell('two', { earned: 0.07, possible: 1, percent: 6.67, calculation_earned: 2 / 30 })]
    const report = buildGradebookStudentReport({ student: { ...student, assessment_scores }, columns, categories })
    expect(report.currentPercent).toBe(4.44)
    expect(report.currentPercent?.toFixed(1)).toBe('4.4')
  })

  it('returns no average when no valid included marks exist and never falls back to email', () => {
    const report = buildGradebookStudentReport({ student: { ...student, student_first_name: null, student_last_name: null, assessment_scores: [cell('bad', { possible: 0 })] }, columns: [column('bad')], categories })
    expect(report).toEqual({ studentName: '', currentPercent: null, items: [] })
  })
})
