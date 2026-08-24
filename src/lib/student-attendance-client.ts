import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'
import {
  studentAttendanceStatusViewSchema,
  type StudentAttendanceStatusView,
} from '@/lib/validations/student-attendance'

const STUDENT_ATTENDANCE_CACHE_PREFIX = 'student-attendance-status:'
const STUDENT_ATTENDANCE_CACHE_TTL_MS = 5_000
const AUTHORITATIVE_CONFIRMATION_TTL_MS = 2 * 60_000
const PROJECTION_RECONCILIATION_MS = 5_000

type AuthoritativeConfirmation = {
  classroomId: string
  occurrenceBinding: string
  attendanceStatus: 'present' | 'late'
  confirmedAt?: string
  expiresAtMonotonicMs: number
}

const authoritativeConfirmations = new Map<
  string,
  Map<string, AuthoritativeConfirmation>
>()

type CachedStudentAttendanceStatus = {
  view: StudentAttendanceStatusView
  receivedAtMonotonicMs: number
}

export class StudentAttendanceIdentityMismatchError extends Error {
  constructor() {
    super('Attendance status identity changed')
    this.name = 'StudentAttendanceIdentityMismatchError'
  }
}

function monotonicNow(): number {
  return typeof performance === 'undefined' ? 0 : performance.now()
}

function earlierInstant(first: string | null, second: string): string {
  if (!first) return second
  return Date.parse(first) <= Date.parse(second) ? first : second
}

function reconcileAuthoritativeConfirmation(
  studentId: string,
  view: StudentAttendanceStatusView,
): StudentAttendanceStatusView {
  const studentConfirmations = authoritativeConfirmations.get(studentId)
  if (!studentConfirmations) return view

  const currentMonotonicMs = monotonicNow()
  const serverNowMs = Date.parse(view.serverNow)
  const projectedClassroomIds = new Set(view.classrooms.map((state) => state.classroomId))
  let nextRefreshAt = view.nextRefreshAt
  let reconciled = false
  const classrooms = view.classrooms.map((state) => {
    const confirmation = studentConfirmations.get(state.classroomId)
    if (!confirmation) return state

    const remainingMs = confirmation.expiresAtMonotonicMs - currentMonotonicMs
    const closesAtMs = state.closesAt ? Date.parse(state.closesAt) : Number.NaN
    if (
      remainingMs <= 0
      || state.state !== 'open'
      || state.occurrenceBinding !== confirmation.occurrenceBinding
      || !Number.isFinite(closesAtMs)
      || closesAtMs <= serverNowMs
    ) {
      studentConfirmations.delete(state.classroomId)
      return state
    }

    reconciled = true
    const validUntilMs = Math.min(serverNowMs + remainingMs, closesAtMs)
    const validUntil = new Date(validUntilMs).toISOString()
    const reconcileAt = new Date(
      Math.min(
        serverNowMs + Math.min(PROJECTION_RECONCILIATION_MS, remainingMs),
        validUntilMs,
      ),
    ).toISOString()
    nextRefreshAt = earlierInstant(nextRefreshAt, reconcileAt)
    return {
      classroomId: state.classroomId,
      state: 'confirmed' as const,
      opensAt: state.opensAt,
      closesAt: state.closesAt,
      attendanceStatus: confirmation.attendanceStatus,
      ...(confirmation.confirmedAt ? { confirmedAt: confirmation.confirmedAt } : {}),
      validUntil,
    }
  })
  for (const classroomId of studentConfirmations.keys()) {
    if (!projectedClassroomIds.has(classroomId)) studentConfirmations.delete(classroomId)
  }
  if (studentConfirmations.size === 0) authoritativeConfirmations.delete(studentId)
  if (!reconciled) return view
  return {
    ...view,
    classrooms,
    nextRefreshAt,
  }
}

export function preserveAuthoritativeStudentAttendanceConfirmation(input: {
  studentId: string
  classroomId: string
  occurrenceBinding: string
  attendanceStatus: 'present' | 'late'
  confirmedAt?: string
}) {
  const studentConfirmations = authoritativeConfirmations.get(input.studentId) ?? new Map()
  studentConfirmations.set(input.classroomId, {
    classroomId: input.classroomId,
    occurrenceBinding: input.occurrenceBinding,
    attendanceStatus: input.attendanceStatus,
    confirmedAt: input.confirmedAt,
    expiresAtMonotonicMs: monotonicNow() + AUTHORITATIVE_CONFIRMATION_TTL_MS,
  })
  authoritativeConfirmations.set(input.studentId, studentConfirmations)
}

export function clearAuthoritativeStudentAttendanceConfirmation(studentId?: string) {
  if (studentId) authoritativeConfirmations.delete(studentId)
  else authoritativeConfirmations.clear()
}

export async function fetchStudentAttendanceStatus(
  studentId: string,
  options: { forceNetwork?: boolean } = {},
): Promise<StudentAttendanceStatusView> {
  if (options.forceNetwork) {
    invalidateCachedJSONMatching(`${STUDENT_ATTENDANCE_CACHE_PREFIX}${studentId}`)
  }
  const cached = await fetchJSONWithCache<CachedStudentAttendanceStatus>(
    `${STUDENT_ATTENDANCE_CACHE_PREFIX}${studentId}`,
    async () => {
      const response = await fetch('/api/student/attendance/status', { cache: 'no-store' })
      if (response.headers.get('x-pika-student-id') !== studentId) {
        clearAuthoritativeStudentAttendanceConfirmation(studentId)
        throw new StudentAttendanceIdentityMismatchError()
      }
      if (!response.ok) throw new Error('Attendance status is temporarily unavailable')
      const body = await response.json().catch(() => null) as unknown
      const view = studentAttendanceStatusViewSchema.parse(body)
      if (view.studentId !== studentId) {
        clearAuthoritativeStudentAttendanceConfirmation(studentId)
        throw new StudentAttendanceIdentityMismatchError()
      }
      return {
        view,
        receivedAtMonotonicMs: monotonicNow(),
      }
    },
    STUDENT_ATTENDANCE_CACHE_TTL_MS,
  )
  const elapsedSinceReceiptMs = Math.max(
    0,
    monotonicNow() - cached.receivedAtMonotonicMs,
  )
  const currentView = elapsedSinceReceiptMs === 0
    ? cached.view
    : {
        ...cached.view,
        serverNow: new Date(
          Date.parse(cached.view.serverNow) + elapsedSinceReceiptMs,
        ).toISOString(),
      }
  return reconcileAuthoritativeConfirmation(studentId, currentView)
}

export function invalidateStudentAttendanceStatus(studentId?: string) {
  invalidateCachedJSONMatching(
    studentId
      ? `${STUDENT_ATTENDANCE_CACHE_PREFIX}${studentId}`
      : STUDENT_ATTENDANCE_CACHE_PREFIX,
  )
}
