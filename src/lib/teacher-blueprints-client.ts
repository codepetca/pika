import type { CourseBlueprint, CourseBlueprintDetail } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type TeacherBlueprintsResponse = {
  blueprints?: CourseBlueprint[]
}

type TeacherBlueprintDetailResponse = {
  blueprint?: CourseBlueprintDetail
}

export const TEACHER_BLUEPRINTS_CACHE_PREFIX = 'teacher-blueprints:'
const TEACHER_BLUEPRINTS_CACHE_TTL_MS = 20_000

async function getTeacherBlueprintsCacheScope(): Promise<string | null> {
  const response = await fetch('/api/auth/me', { cache: 'no-store' })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || typeof data.user?.id !== 'string') {
    return null
  }
  return data.user.id
}

async function fetchTeacherBlueprintsFromApi(): Promise<TeacherBlueprintsResponse> {
  const response = await fetch('/api/teacher/course-blueprints')
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load course blueprints')
  }
  return data
}

async function fetchTeacherBlueprintDetailFromApi(id: string): Promise<TeacherBlueprintDetailResponse> {
  const response = await fetch(`/api/teacher/course-blueprints/${id}`)
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || 'Failed to load course blueprint')
  }
  return data
}

export async function fetchTeacherBlueprints(): Promise<CourseBlueprint[]> {
  const scope = await getTeacherBlueprintsCacheScope()
  if (!scope) {
    const data = await fetchTeacherBlueprintsFromApi()
    return data.blueprints || []
  }

  const data = await fetchJSONWithCache<TeacherBlueprintsResponse>(
    `${TEACHER_BLUEPRINTS_CACHE_PREFIX}${scope}:list`,
    fetchTeacherBlueprintsFromApi,
    TEACHER_BLUEPRINTS_CACHE_TTL_MS,
  )

  return data.blueprints || []
}

export async function fetchTeacherBlueprintDetail(id: string): Promise<CourseBlueprintDetail> {
  const scope = await getTeacherBlueprintsCacheScope()
  if (!scope) {
    const data = await fetchTeacherBlueprintDetailFromApi(id)
    if (!data.blueprint) throw new Error('Failed to load course blueprint')
    return data.blueprint
  }

  const data = await fetchJSONWithCache<TeacherBlueprintDetailResponse>(
    `${TEACHER_BLUEPRINTS_CACHE_PREFIX}${scope}:detail:${id}`,
    () => fetchTeacherBlueprintDetailFromApi(id),
    TEACHER_BLUEPRINTS_CACHE_TTL_MS,
  )

  if (!data.blueprint) throw new Error('Failed to load course blueprint')
  return data.blueprint
}

export function invalidateTeacherBlueprints() {
  invalidateCachedJSONMatching(TEACHER_BLUEPRINTS_CACHE_PREFIX)
}
