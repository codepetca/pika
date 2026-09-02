export type ManualAttendanceSourceMode = 'log' | 'manual'
export type ManualAttendanceStatus = 'present' | 'late' | 'absent'
export type ManualAttendanceMark = ManualAttendanceStatus | 'automatic'

export const MAX_MANUAL_ATTENDANCE_MARKS_PER_REQUEST = 200

export interface ManualAttendanceSettings {
  sourceMode: ManualAttendanceSourceMode
  sessionStartsLocal: string | null
  sessionEndsLocal: string | null
  revision: number
}

export interface ManualAttendanceOverride {
  studentId: string
  status: ManualAttendanceStatus
}

export interface ManualAttendanceView {
  classroomId: string
  classDate: string
  settings: ManualAttendanceSettings
  overrides: ManualAttendanceOverride[]
}

export const DEFAULT_MANUAL_ATTENDANCE_SETTINGS: ManualAttendanceSettings = {
  sourceMode: 'manual',
  sessionStartsLocal: null,
  sessionEndsLocal: null,
  revision: 1,
}

export function deriveManualAttendanceStatus(input: {
  sourceMode: ManualAttendanceSourceMode
  hasCompletedLog: boolean
  override?: ManualAttendanceStatus | null
}): ManualAttendanceStatus | 'unmarked' {
  if (input.override) return input.override
  return input.sourceMode === 'log' && input.hasCompletedLog ? 'present' : 'unmarked'
}
