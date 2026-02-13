import type { CanonicalSyncDataset, MappedOperation } from './types'

export function mapDatasetToOperations(dataset: CanonicalSyncDataset): MappedOperation[] {
  return [
    ...dataset.attendance.map((row) => ({
      entity_type: 'attendance' as const,
      entity_key: row.entity_key,
      payload: {
        student_key: row.student_key,
        date: row.date,
        status: row.status,
      },
    })),
    ...dataset.marks.map((row) => ({
      entity_type: 'mark' as const,
      entity_key: row.entity_key,
      payload: {
        student_key: row.student_key,
        assessment_key: row.assessment_key,
        earned: row.earned,
        possible: row.possible,
      },
    })),
    ...dataset.report_cards.map((row) => ({
      entity_type: 'report_card' as const,
      entity_key: row.entity_key,
      payload: {
        student_key: row.student_key,
        term: row.term,
        percent: row.percent,
        comment: row.comment || '',
      },
    })),
  ]
}
