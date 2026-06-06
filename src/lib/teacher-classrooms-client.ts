import type { Classroom } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type TeacherClassroomsResponse = {
  classrooms?: Classroom[]
}

export const TEACHER_CLASSROOMS_CACHE_PREFIX = 'teacher-classrooms:'
const TEACHER_CLASSROOMS_CACHE_TTL_MS = 20_000

async function getTeacherClassroomsCacheKey(): Promise<string | null> {
  const response = await fetch('/api/auth/me', { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || typeof data.user?.id !== 'string') {
    return null
  }
  const userId = data.user.id
  return `${TEACHER_CLASSROOMS_CACHE_PREFIX}${userId}:list`
}

async function fetchTeacherClassroomsFromApi(): Promise<TeacherClassroomsResponse> {
  const response = await fetch('/api/teacher/classrooms')
  const data = await response.json().catch(() => ({ classrooms: [] }))
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Failed to load classrooms'
    throw new Error(message)
  }
  return data
}

export async function fetchTeacherClassrooms(): Promise<Classroom[]> {
  const cacheKey = await getTeacherClassroomsCacheKey()
  if (!cacheKey) {
    const data = await fetchTeacherClassroomsFromApi()
    return data.classrooms || []
  }

  const data = await fetchJSONWithCache<TeacherClassroomsResponse>(
    cacheKey,
    fetchTeacherClassroomsFromApi,
    TEACHER_CLASSROOMS_CACHE_TTL_MS,
  )

  return data.classrooms || []
}

export function invalidateTeacherClassrooms() {
  invalidateCachedJSONMatching(TEACHER_CLASSROOMS_CACHE_PREFIX)
}
