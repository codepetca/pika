import type { Classroom } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type TeacherClassroomsResponse = {
  classrooms?: Classroom[]
}

type TeacherClassroomsOptions = {
  archived?: boolean
}

export const TEACHER_CLASSROOMS_CACHE_PREFIX = 'teacher-classrooms:'
const TEACHER_CLASSROOMS_CACHE_TTL_MS = 20_000

function getTeacherClassroomsListSegment(options: TeacherClassroomsOptions = {}) {
  return options.archived ? 'archived-list' : 'active-list'
}

async function getTeacherClassroomsCacheKey(options: TeacherClassroomsOptions = {}): Promise<string | null> {
  const response = await fetch('/api/auth/me', { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || typeof data.user?.id !== 'string') {
    return null
  }
  const userId = data.user.id
  return `${TEACHER_CLASSROOMS_CACHE_PREFIX}${userId}:${getTeacherClassroomsListSegment(options)}`
}

async function fetchTeacherClassroomsFromApi(options: TeacherClassroomsOptions = {}): Promise<TeacherClassroomsResponse> {
  const response = await fetch(options.archived ? '/api/teacher/classrooms?archived=true' : '/api/teacher/classrooms')
  const data = await response.json().catch(() => ({ classrooms: [] }))
  if (!response.ok) {
    const message = typeof data.error === 'string' ? data.error : 'Failed to load classrooms'
    throw new Error(message)
  }
  return data
}

export async function fetchTeacherClassrooms(options: TeacherClassroomsOptions = {}): Promise<Classroom[]> {
  const cacheKey = await getTeacherClassroomsCacheKey(options)
  if (!cacheKey) {
    const data = await fetchTeacherClassroomsFromApi(options)
    return data.classrooms || []
  }

  const data = await fetchJSONWithCache<TeacherClassroomsResponse>(
    cacheKey,
    () => fetchTeacherClassroomsFromApi(options),
    TEACHER_CLASSROOMS_CACHE_TTL_MS,
  )

  return data.classrooms || []
}

export function invalidateTeacherClassrooms() {
  invalidateCachedJSONMatching(TEACHER_CLASSROOMS_CACHE_PREFIX)
}
