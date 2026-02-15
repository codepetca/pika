import type { CanonicalSyncDataset } from './types'

export function ingestDataset(payload: unknown): CanonicalSyncDataset {
  const input = (payload || {}) as Record<string, unknown>

  return {
    attendance: Array.isArray(input.attendance) ? (input.attendance as CanonicalSyncDataset['attendance']) : [],
    marks: Array.isArray(input.marks) ? (input.marks as CanonicalSyncDataset['marks']) : [],
    report_cards: Array.isArray(input.report_cards)
      ? (input.report_cards as CanonicalSyncDataset['report_cards'])
      : [],
  }
}
