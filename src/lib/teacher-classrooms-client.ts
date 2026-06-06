import type { Classroom } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

type TeacherClassroomsResponse = {
  classrooms?: Classroom[]
}

export const TEACHER_CLASSROOMS_CACHE_KEY = 'teacher-classrooms:list'
const TEACHER_CLASSROOMS_CACHE_TTL_MS = 20_000

export async function fetchTeacherClassrooms(): Promise<Classroom[]> {
  const data = await fetchJSONWithCache<TeacherClassroomsResponse>(
    TEACHER_CLASSROOMS_CACHE_KEY,
    async () => {
      const response = await fetch('/api/teacher/classrooms')
      const data = await response.json().catch(() => ({ classrooms: [] }))
      if (!response.ok) {
        const message = typeof data.error === 'string' ? data.error : 'Failed to load classrooms'
        throw new Error(message)
      }
      return data
    },
    TEACHER_CLASSROOMS_CACHE_TTL_MS,
  )

  return data.classrooms || []
}

export function invalidateTeacherClassrooms() {
  invalidateCachedJSON(TEACHER_CLASSROOMS_CACHE_KEY)
}
