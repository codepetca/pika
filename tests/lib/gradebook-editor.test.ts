import { describe, expect, it } from 'vitest'
import { buildGradebookCsv, DEFAULT_GRADEBOOK_PREFERENCES, isValidGradebookWeight, normalizeGradebookPreferences } from '@/lib/gradebook-editor'
import type { GradebookStudentSummary } from '@/types'

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
})
