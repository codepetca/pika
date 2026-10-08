import type { Classroom } from '@/types'
import { fetchJSON, fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type StudentClassroomsResponse = {
  classrooms: Classroom[]
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
  const data = await fetchJSON<unknown>('/api/student/classrooms', {
    errorMessage: 'Failed to load classrooms',
  })
  if (!data || typeof data !== 'object' || !('classrooms' in data) || !Array.isArray(data.classrooms)) {
    throw new Error('Failed to load classrooms')
  }
  return { classrooms: data.classrooms as Classroom[] }
}

export async function fetchStudentClassrooms(): Promise<Classroom[]> {
  const cacheKey = await getStudentClassroomsCacheKey()
  if (!cacheKey) {
    const data = await fetchStudentClassroomsFromApi()
    return data.classrooms
  }

  const data = await fetchJSONWithCache<StudentClassroomsResponse>(
    cacheKey,
    fetchStudentClassroomsFromApi,
    STUDENT_CLASSROOMS_CACHE_TTL_MS,
  )

  return data.classrooms
}

export function invalidateStudentClassrooms() {
  invalidateCachedJSONMatching(STUDENT_CLASSROOMS_CACHE_PREFIX)
}
