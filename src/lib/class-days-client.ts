import type { ClassDay } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

type ClassDaysResponse = {
  class_days?: ClassDay[]
}

const CLASS_DAYS_CACHE_TTL_MS = 20_000

export function getClassDaysCacheKey(classroomId: string): string {
  return `class-days:${classroomId}`
}

export async function fetchClassDaysForClassroom(classroomId: string): Promise<ClassDay[]> {
  const data = await fetchJSONWithCache<ClassDaysResponse>(
    getClassDaysCacheKey(classroomId),
    async () => {
      const response = await fetch(`/api/classrooms/${classroomId}/class-days`)
      const data = await response.json().catch(() => ({ class_days: [] }))
      if (!response.ok) {
        const message = typeof data.error === 'string' ? data.error : 'Failed to load class days'
        throw new Error(message)
      }
      return data
    },
    CLASS_DAYS_CACHE_TTL_MS,
  )

  return data.class_days || []
}

export function invalidateClassDaysForClassroom(classroomId: string) {
  invalidateCachedJSON(getClassDaysCacheKey(classroomId))
}
