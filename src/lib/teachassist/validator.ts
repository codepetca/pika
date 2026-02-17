import type { CanonicalSyncDataset } from './types'

export function validateDataset(dataset: CanonicalSyncDataset): string[] {
  const errors: string[] = []
  const attendanceDates = new Set<string>()

  dataset.attendance.forEach((row, index) => {
    if (!row.entity_key) errors.push(`attendance[${index}].entity_key is required`)
    if (!row.student_key) errors.push(`attendance[${index}].student_key is required`)
    if (!row.date) errors.push(`attendance[${index}].date is required`)
    if (row.date) attendanceDates.add(row.date)
  })

  if (attendanceDates.size > 1) {
    errors.push('attendance sync payload must contain exactly one date per job')
  }

  dataset.marks.forEach((row, index) => {
    if (!row.entity_key) errors.push(`marks[${index}].entity_key is required`)
    if (!row.student_key) errors.push(`marks[${index}].student_key is required`)
    if (!row.assessment_key) errors.push(`marks[${index}].assessment_key is required`)
    if (row.possible <= 0) errors.push(`marks[${index}].possible must be > 0`)
    if (row.earned < 0) errors.push(`marks[${index}].earned must be >= 0`)
  })

  dataset.report_cards.forEach((row, index) => {
    if (!row.entity_key) errors.push(`report_cards[${index}].entity_key is required`)
    if (!row.student_key) errors.push(`report_cards[${index}].student_key is required`)
    if (row.percent < 0 || row.percent > 100) {
      errors.push(`report_cards[${index}].percent must be between 0 and 100`)
    }
  })

  return errors
}
