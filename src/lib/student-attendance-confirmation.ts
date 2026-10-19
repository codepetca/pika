import { addDaysToDateString } from '@/lib/date-string'
import { formatDateInToronto, toTorontoStartOfDayIso } from '@/lib/timezone'
import type { StudentAttendanceCheckInView, StudentAttendanceStatusView } from '@/lib/validations/student-attendance'

export type CurrentAttendanceConfirmation = StudentAttendanceCheckInView & {
  studentId: string
  classroomId: string
  occurrenceBinding: string
  attendanceStatus: 'present' | 'late'
  recordedAt: string
  classDate: string
  serverNow: string
  validUntil: string
}

export function isCurrentAttendanceConfirmation(
  result: StudentAttendanceCheckInView,
  nowMs?: number,
): result is CurrentAttendanceConfirmation {
  if (result.state !== 'checked_in' && result.state !== 'already_checked_in') return false
  if (!result.studentId || !result.classroomId || !result.occurrenceBinding
    || !result.attendanceStatus || !result.recordedAt || !result.classDate
    || !result.serverNow || !result.validUntil) return false
  const serverNow = Date.parse(result.serverNow)
  const now = nowMs ?? serverNow
  const recorded = Date.parse(result.recordedAt)
  const deadline = Date.parse(result.validUntil)
  if (![serverNow, now, recorded, deadline].every(Number.isFinite)) return false
  if (recorded > serverNow || now >= deadline || serverNow >= deadline) return false
  if (formatDateInToronto(new Date(now)) !== result.classDate
    || formatDateInToronto(new Date(serverNow)) !== result.classDate
    || formatDateInToronto(new Date(recorded)) !== result.classDate) return false
  return deadline <= Date.parse(toTorontoStartOfDayIso(addDaysToDateString(result.classDate, 1)))
}

export function matchRefreshedAttendanceConfirmation(
  previous: CurrentAttendanceConfirmation,
  view: StudentAttendanceStatusView,
): CurrentAttendanceConfirmation | null {
  if (view.studentId !== previous.studentId) return null
  const state = view.classrooms.find((candidate) => candidate.classroomId === previous.classroomId)
  if (state?.state !== 'confirmed' || state.classDate !== previous.classDate
    || state.occurrenceBinding !== previous.occurrenceBinding) return null
  const refreshed = {
    ...previous,
    recordedAt: state.confirmedAt,
    attendanceStatus: state.attendanceStatus,
    validUntil: state.validUntil,
    serverNow: view.serverNow,
  }
  return isCurrentAttendanceConfirmation(refreshed) ? refreshed : null
}

export type AttendanceConfirmationClock = {
  serverMs: number
  wallMs: number
  monotonicMs: number
}

function monotonicNow() { return typeof performance === 'undefined' ? 0 : performance.now() }

export function anchorAttendanceConfirmation(serverNow: string, requestElapsedMs = 0): AttendanceConfirmationClock {
  return { serverMs: Date.parse(serverNow) + Math.max(0, requestElapsedMs), wallMs: Date.now(), monotonicMs: monotonicNow() }
}

export function attendanceConfirmationNow(anchor: AttendanceConfirmationClock): number {
  // Use elapsed time rather than the phone's absolute clock. The wall-clock
  // delta also catches devices whose monotonic clock pauses during sleep.
  return anchor.serverMs + Math.max(0, Date.now() - anchor.wallMs, monotonicNow() - anchor.monotonicMs)
}
