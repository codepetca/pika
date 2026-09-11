import { describe, expect, it } from 'vitest'
import { buildGradebookCsv, DEFAULT_GRADEBOOK_PREFERENCES, isValidGradebookWeight, normalizeGradebookPreferences } from '@/lib/gradebook-editor'
import type { GradebookAssessmentColumn, GradebookStudentSummary } from '@/types'

describe('gradebook editor helpers', () => {
  it('accepts only supported persisted display preferences', () => {
    expect(normalizeGradebookPreferences(null)).toEqual(DEFAULT_GRADEBOOK_PREFERENCES)
    expect(normalizeGradebookPreferences({ scoreDisplayMode: 'html', summaryKind: 2, showWeights: 'yes', lastNameFirst: true })).toEqual({ ...DEFAULT_GRADEBOOK_PREFERENCES, lastNameFirst: true })
  })
  it.each([0, -1, 1.5, 1000, NaN, Infinity])('rejects invalid item weight %s', (weight) => {
    expect(isValidGradebookWeight(weight)).toBe(false)
  })
  it('quotes CSV text and neutralizes spreadsheet formulas', () => {
    const student = {
      student_first_name: '=formula()', student_last_name: 'A, "B"', student_number: '0012', student_email: 'demo@example.com', final_percent: 80,
    } as GradebookStudentSummary
    expect(buildGradebookCsv([student], [], 'percent')).toBe('"First","Last","ID","Email","Final"\r\n"\'=formula()","A, ""B""","0012","demo@example.com","80.0%"')
  })
  it('exports standalone originals, explicit zeroes, blanks, and the existing final mark', () => {
    const columns: GradebookAssessmentColumn[] = ['Attendance – Term 1', 'Blank'].map((title, i) => ({
      assessment_id: String(i), assessment_type: 'item', title, code: `I${i + 1}`,
      possible: 20, weight: 10, include_in_final: true,
    }))
    const student = { student_first_name: 'Avery', student_last_name: 'Chen', student_number: '0012', student_email: 'a@example.test', final_percent: 0,
      assessment_scores: [{ assessment_id: '0', assessment_type: 'item', earned: 0, possible: 20, percent: 0, is_graded: true }],
    } as GradebookStudentSummary
    expect(buildGradebookCsv([student], columns, 'raw')).toContain('"0/20","—","0.0%"')
    expect(buildGradebookCsv([student], columns, 'percent')).toContain('"0%","—","0.0%"')
    expect(buildGradebookCsv([student], columns, 'raw')).toContain('"Attendance – Term 1","Blank"')
  })

})
