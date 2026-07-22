import type { AttendanceRecord, Entry } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

type TeacherAttendanceResponse = {
  attendance?: AttendanceRecord[]
  dates?: string[]
}

const TEACHER_DASHBOARD_CACHE_TTL_MS = 20_000

export function getTeacherDashboardAttendanceCacheKey(classroomId: string): string {
  return `teacher-dashboard:attendance:${classroomId}`
}

export async function fetchTeacherDashboardAttendance(classroomId: string): Promise<{
  attendance: AttendanceRecord[]
  dates: string[]
}> {
  const data = await fetchJSONWithCache<TeacherAttendanceResponse>(
    getTeacherDashboardAttendanceCacheKey(classroomId),
    async () => {
      const response = await fetch(`/api/teacher/attendance?classroom_id=${classroomId}`)
      const data = await response.json().catch(() => ({ attendance: [], dates: [] }))
      if (!response.ok) {
        const message = typeof data.error === 'string' ? data.error : 'Failed to load attendance'
        throw new Error(message)
      }
      return data
    },
    TEACHER_DASHBOARD_CACHE_TTL_MS,
  )

  return {
    attendance: data.attendance || [],
    dates: data.dates || [],
  }
}

export async function fetchTeacherDashboardEntry(
  classroomId: string,
  studentId: string,
  date: string,
): Promise<Entry | null> {
  const searchParams = new URLSearchParams({
    classroom_id: classroomId,
    student_id: studentId,
    date,
    limit: '1',
  })
  const response = await fetch(`/api/teacher/student-history?${searchParams}`)
  const data = await response.json().catch(() => ({ entries: [] }))
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Failed to load entry'
    throw new Error(message)
  }
  return data.entries?.[0] || null
}

export function invalidateTeacherDashboardAttendance(classroomId: string) {
  invalidateCachedJSON(getTeacherDashboardAttendanceCacheKey(classroomId))
}
