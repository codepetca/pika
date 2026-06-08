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

export async function fetchTeacherDashboardEntries(classroomId: string): Promise<Entry[]> {
  const response = await fetch(`/api/student/entries?classroom_id=${classroomId}`)
  const data = await response.json().catch(() => ({ entries: [] }))
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Failed to load entries'
    throw new Error(message)
  }
  return data.entries || []
}

export function invalidateTeacherDashboardAttendance(classroomId: string) {
  invalidateCachedJSON(getTeacherDashboardAttendanceCacheKey(classroomId))
}
