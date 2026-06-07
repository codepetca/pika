import type { Classroom } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type StudentClassroomsResponse = {
  classrooms?: Classroom[]
}

export const STUDENT_CLASSROOMS_CACHE_PREFIX = 'student-classrooms:'
const STUDENT_CLASSROOMS_CACHE_TTL_MS = 20_000

async function getStudentClassroomsCacheKey(): Promise<string | null> {
  const response = await fetch('/api/auth/me', { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || typeof data.user?.id !== 'string') {
    return null
  }
  return `${STUDENT_CLASSROOMS_CACHE_PREFIX}${data.user.id}:list`
}

async function fetchStudentClassroomsFromApi(): Promise<StudentClassroomsResponse> {
  const response = await fetch('/api/student/classrooms')
  const data = await response.json().catch(() => ({ classrooms: [] }))
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Failed to load classrooms'
    throw new Error(message)
  }
  return data
}

export async function fetchStudentClassrooms(): Promise<Classroom[]> {
  const cacheKey = await getStudentClassroomsCacheKey()
  if (!cacheKey) {
    const data = await fetchStudentClassroomsFromApi()
    return data.classrooms || []
  }

  const data = await fetchJSONWithCache<StudentClassroomsResponse>(
    cacheKey,
    fetchStudentClassroomsFromApi,
    STUDENT_CLASSROOMS_CACHE_TTL_MS,
  )

  return data.classrooms || []
}

export function invalidateStudentClassrooms() {
  invalidateCachedJSONMatching(STUDENT_CLASSROOMS_CACHE_PREFIX)
}
