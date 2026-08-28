export type TeacherAttendanceStatus = 'unmarked' | 'present' | 'late' | 'absent'
export type TeacherAttendanceSource = 'student_qr' | 'staff' | 'system'

export interface TeacherAttendanceQrPresentation {
  entryPath: string
  expiresAt: string
  revision: number
}
export type TeacherAttendanceSessionState =
  | 'not_scheduled'
  | 'scheduled'
  | 'open'
  | 'closed'
  | 'cancelled'

/**
 * Pika-owned browser contract for the native teacher attendance surface.
 * Provider identifiers and provider-specific transport details must not enter
 * this shape; server adapters translate them into this projection.
 */
export interface TeacherAttendanceView {
  classroomId: string
  classDate: string
  integration: 'disabled' | 'not_configured' | 'ready'
  session: {
    state: TeacherAttendanceSessionState
    opensAt: string | null
    closesAt: string | null
    sessionStartsAt: string | null
    sessionEndsAt: string | null
    presentThroughAt: string | null
    absentAt: string | null
    revision: number | null
    commandFailed: boolean
  }
  sync: {
    state: 'current' | 'pending' | 'stale' | 'unavailable'
    confirmedAt: string | null
  }
  students: Array<{
    studentId: string
    firstName: string
    lastName: string
    status: TeacherAttendanceStatus
    source: TeacherAttendanceSource | null
    revision: number | null
    checkedInAt: string | null
    checkInRef: string | null
    hasManualOverride: boolean
    pendingCommand: boolean
    commandFailed: boolean
  }>
}
