import type { TiptapContent } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

type ClassResources = {
  id?: string
  classroom_id?: string
  content?: TiptapContent
  updated_at?: string
  updated_by?: string
}

type ClassResourcesResponse = {
  resources?: ClassResources | null
  error?: unknown
}

const CLASS_RESOURCES_CACHE_TTL_MS = 20_000

export function getTeacherClassResourcesCacheKey(classroomId: string): string {
  return `teacher-resources:${classroomId}`
}

export function getStudentClassResourcesCacheKey(classroomId: string): string {
  return `student-resources:${classroomId}`
}

async function parseClassResourcesResponse(response: Response, fallbackMessage: string): Promise<ClassResourcesResponse> {
  let data: ClassResourcesResponse
  try {
    data = await response.json()
  } catch {
    if (!response.ok) {
      data = {}
    } else {
      throw new Error(`${fallbackMessage}: invalid response`)
    }
  }

  if (!response.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : fallbackMessage)
  }

  return data
}

export async function fetchTeacherClassResources(classroomId: string): Promise<TiptapContent | null> {
  const data = await fetchJSONWithCache<ClassResourcesResponse>(
    getTeacherClassResourcesCacheKey(classroomId),
    async () => {
      const response = await fetch(`/api/teacher/classrooms/${classroomId}/resources`)
      return parseClassResourcesResponse(response, 'Failed to load resources')
    },
    CLASS_RESOURCES_CACHE_TTL_MS,
  )

  return data.resources?.content ?? null
}

export async function fetchStudentClassResources(classroomId: string): Promise<TiptapContent | null> {
  const data = await fetchJSONWithCache<ClassResourcesResponse>(
    getStudentClassResourcesCacheKey(classroomId),
    async () => {
      const response = await fetch(`/api/student/classrooms/${classroomId}/resources`)
      return parseClassResourcesResponse(response, 'Failed to load resources')
    },
    CLASS_RESOURCES_CACHE_TTL_MS,
  )

  return data.resources?.content ?? null
}

export function invalidateClassResourcesForClassroom(classroomId: string) {
  invalidateCachedJSON(getTeacherClassResourcesCacheKey(classroomId))
  invalidateCachedJSON(getStudentClassResourcesCacheKey(classroomId))
}
