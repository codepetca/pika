import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'
import {
  studentAttendanceStatusViewSchema,
  type StudentAttendanceStatusView,
} from '@/lib/validations/student-attendance'

const STUDENT_ATTENDANCE_CACHE_PREFIX = 'student-attendance-status:'
const STUDENT_ATTENDANCE_CACHE_TTL_MS = 5_000

export async function fetchStudentAttendanceStatus(
  studentId: string,
  options: { forceNetwork?: boolean } = {},
): Promise<StudentAttendanceStatusView> {
  if (options.forceNetwork) {
    invalidateCachedJSONMatching(`${STUDENT_ATTENDANCE_CACHE_PREFIX}${studentId}`)
  }
  return await fetchJSONWithCache(
    `${STUDENT_ATTENDANCE_CACHE_PREFIX}${studentId}`,
    async () => {
      const response = await fetch('/api/student/attendance/status', { cache: 'no-store' })
      const body = await response.json().catch(() => null) as unknown
      if (!response.ok) throw new Error('Attendance status is temporarily unavailable')
      return studentAttendanceStatusViewSchema.parse(body)
    },
    STUDENT_ATTENDANCE_CACHE_TTL_MS,
  )
}

export function invalidateStudentAttendanceStatus(studentId?: string) {
  invalidateCachedJSONMatching(
    studentId
      ? `${STUDENT_ATTENDANCE_CACHE_PREFIX}${studentId}`
      : STUDENT_ATTENDANCE_CACHE_PREFIX,
  )
}
