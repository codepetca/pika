import type { Classroom } from '@/types'
import {
  teacherArchivedClassroomRecoverySchema,
  type ClassroomColdArchiveSummary,
} from '@/lib/contracts/classroom-lifecycle'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type TeacherClassroomsResponse = {
  classrooms?: Classroom[]
  cold_archives?: unknown
  cold_archive_restore_enabled?: unknown
}

type TeacherClassroomsOptions = {
  archived?: boolean
}

export const TEACHER_CLASSROOMS_CACHE_PREFIX = 'teacher-classrooms:'
const TEACHER_CLASSROOMS_CACHE_TTL_MS = 20_000

export type TeacherArchivedClassroomState = {
  classrooms: Classroom[]
  coldArchives: ClassroomColdArchiveSummary[]
  coldArchiveRestoreEnabled: boolean
}

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

async function fetchTeacherClassroomsResponse(
  options: TeacherClassroomsOptions = {},
): Promise<TeacherClassroomsResponse> {
  const cacheKey = await getTeacherClassroomsCacheKey(options)
  if (!cacheKey) {
    return fetchTeacherClassroomsFromApi(options)
  }

  return fetchJSONWithCache<TeacherClassroomsResponse>(
    cacheKey,
    () => fetchTeacherClassroomsFromApi(options),
    TEACHER_CLASSROOMS_CACHE_TTL_MS,
  )
}

export async function fetchTeacherClassrooms(options: TeacherClassroomsOptions = {}): Promise<Classroom[]> {
  const data = await fetchTeacherClassroomsResponse(options)

  return data.classrooms || []
}

export async function fetchTeacherArchivedClassroomState(): Promise<TeacherArchivedClassroomState> {
  const data = await fetchTeacherClassroomsResponse({ archived: true })
  const recovery = teacherArchivedClassroomRecoverySchema.parse({
    cold_archives: data.cold_archives ?? [],
    cold_archive_restore_enabled: data.cold_archive_restore_enabled ?? false,
  })
  return {
    classrooms: data.classrooms || [],
    coldArchives: recovery.cold_archives,
    coldArchiveRestoreEnabled: recovery.cold_archive_restore_enabled,
  }
}

export function invalidateTeacherClassrooms() {
  invalidateCachedJSONMatching(TEACHER_CLASSROOMS_CACHE_PREFIX)
}
