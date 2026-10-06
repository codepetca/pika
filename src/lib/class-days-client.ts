import type { ClassDay } from '@/types'
import { fetchJSON, fetchJSONWithCache, invalidateCachedJSON } from '@/lib/request-cache'

type ClassDaysResponse = {
  class_days: ClassDay[]
}

const CLASS_DAYS_CACHE_TTL_MS = 20_000

export function getClassDaysCacheKey(classroomId: string): string {
  return `class-days:${classroomId}`
}

export async function fetchClassDaysForClassroom(classroomId: string): Promise<ClassDay[]> {
  const data = await fetchJSONWithCache<ClassDaysResponse>(
    getClassDaysCacheKey(classroomId),
    async () => {
      const data = await fetchJSON<unknown>(`/api/classrooms/${classroomId}/class-days`, {
        errorMessage: 'Failed to load class days',
      })
      if (!data || typeof data !== 'object' || !('class_days' in data) || !Array.isArray(data.class_days)) {
        throw new Error('Failed to load class days')
      }
      return { class_days: data.class_days as ClassDay[] }
    },
    CLASS_DAYS_CACHE_TTL_MS,
  )

  return data.class_days
}

export function invalidateClassDaysForClassroom(classroomId: string) {
  invalidateCachedJSON(getClassDaysCacheKey(classroomId))
}
