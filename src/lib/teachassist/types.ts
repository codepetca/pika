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

// ---------------------------------------------------------------------------
// Playwright attendance sync types
// ---------------------------------------------------------------------------

/** TeachAssist attendance status codes (radio button values) */
export type TAAttendanceCode = 'P' | 'L' | 'A' | 'E'

/**
 * Controls how the Playwright sync interacts with TeachAssist.
 *
 * - `confirmation`: Fills out the form but opens a visible browser window
 *   so the teacher can review and click "Record Attendance" themselves.
 *   Playwright waits for the manual submit before moving to the next date.
 *
 * - `full_auto`: Runs headless — fills the form AND clicks submit automatically.
 */
export type TAExecutionMode = 'confirmation' | 'full_auto'

/** Per-classroom TeachAssist configuration stored in teachassist_mappings.config */
export interface TAConfig {
  ta_username: string
  ta_password_encrypted: string
  ta_base_url: string // e.g. "https://ta.yrdsb.ca/yrdsb/"
  ta_course_search: string // substring to match in sidebar, e.g. "GLD2OOH"
  ta_block: string // e.g. "A1"
  ta_execution_mode: TAExecutionMode // default: "confirmation"
}

/** Credentials decrypted and ready for use */
export interface TACredentials {
  username: string
  password: string
  baseUrl: string
}

/** A student row as read from the TeachAssist attendance page */
export interface TAStudentRow {
  name: string // "Last, First" as shown in TA
  radioName: string // e.g. "r235793_attendance_721578"
}

/** State of the TA attendance page after parsing */
export interface TAAttendancePageState {
  date: string // current date on the form (YYYY-MM-DD)
  block: string // current block code
  students: TAStudentRow[]
}

/** Result of matching a single Pika student to a TA student row */
export interface StudentMatchResult {
  student_id: string
  pika: { first: string; last: string }
  ta_name: string | null
  ta_radio_name: string | null
  confidence: number // 0–100
  matched: boolean
}

/** A single attendance entry to push into TA for one student on one date */
export interface TAAttendanceEntry {
  radioName: string
  status: TAAttendanceCode
}

/** Input for the Playwright attendance sync orchestrator */
export interface AttendanceSyncInput {
  classroomId: string
  mode: SyncMode
  createdBy: string
  dateRange?: { from: string; to: string }
  executionMode?: TAExecutionMode // overrides config; defaults to config value
}

/** Result returned by the attendance sync orchestrator */
export interface AttendanceSyncResult {
  jobId: string
  ok: boolean
  summary: SyncSummary
  errors: SyncError[]
  unmatchedStudents: StudentMatchResult[]
}

/** Structured sync error */
export interface SyncError {
  type: 'authentication' | 'navigation' | 'student_not_found' | 'form_submission' | 'browser' | 'validation'
  message: string
  date?: string
  studentId?: string
  recoverable: boolean
}
