export type SyncMode = 'dry_run' | 'execute'
export type SyncEntityType = 'attendance' | 'mark' | 'report_card'

export interface CanonicalAttendanceRecord {
  entity_key: string
  student_key: string
  date: string
  status: 'present' | 'absent'
}

export interface CanonicalMarkRecord {
  entity_key: string
  student_key: string
  assessment_key: string
  earned: number
  possible: number
}

export interface CanonicalReportCardRecord {
  entity_key: string
  student_key: string
  term: 'midterm' | 'final'
  percent: number
  comment?: string
}

export interface CanonicalSyncDataset {
  attendance: CanonicalAttendanceRecord[]
  marks: CanonicalMarkRecord[]
  report_cards: CanonicalReportCardRecord[]
}

export interface MappedOperation {
  entity_type: SyncEntityType
  entity_key: string
  payload: Record<string, unknown>
}

export interface PlannedOperation extends MappedOperation {
  payload_hash: string
  action: 'upsert' | 'noop'
}

export interface ExecutedOperation extends PlannedOperation {
  status: 'success' | 'failed' | 'skipped'
  error_message?: string
  response_payload?: Record<string, unknown>
}

export interface SyncSummary {
  planned: number
  upserted: number
  skipped: number
  failed: number
}
