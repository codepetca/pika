import type { CanonicalSyncDataset } from './types'

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

function toNumber(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function normalizeDataset(dataset: CanonicalSyncDataset): CanonicalSyncDataset {
  return {
    attendance: dataset.attendance.map((row) => ({
      entity_key: trim(row.entity_key),
      student_key: trim(row.student_key),
      date: trim(row.date),
      status: row.status === 'present' ? 'present' : 'absent',
    })),
    marks: dataset.marks.map((row) => ({
      entity_key: trim(row.entity_key),
      student_key: trim(row.student_key),
      assessment_key: trim(row.assessment_key),
      earned: toNumber(row.earned),
      possible: toNumber(row.possible),
    })),
    report_cards: dataset.report_cards.map((row) => ({
      entity_key: trim(row.entity_key),
      student_key: trim(row.student_key),
      term: row.term === 'midterm' ? 'midterm' : 'final',
      percent: toNumber(row.percent),
      comment: row.comment ? trim(row.comment) : '',
    })),
  }
}
