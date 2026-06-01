import type { Entry } from '@/types'
import { fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type StudentEntriesResponse = {
  entries?: Entry[]
}

type StudentEntriesOptions = {
  limit?: number
}

const STUDENT_ENTRIES_CACHE_TTL_MS = 15_000

export function getStudentEntriesCachePrefix(classroomId: string): string {
  return `student-entries:${classroomId}:`
}

export function getStudentEntriesCacheKey(
  classroomId: string,
  options: StudentEntriesOptions = {},
): string {
  const scope = typeof options.limit === 'number' ? `limit:${options.limit}` : 'all'
  return `${getStudentEntriesCachePrefix(classroomId)}${scope}`
}

export async function fetchStudentEntriesForClassroom(
  classroomId: string,
  options: StudentEntriesOptions = {},
): Promise<Entry[]> {
  const data = await fetchJSONWithCache<StudentEntriesResponse>(
    getStudentEntriesCacheKey(classroomId, options),
    async () => {
      const params = new URLSearchParams({ classroom_id: classroomId })
      if (typeof options.limit === 'number') {
        params.set('limit', String(options.limit))
      }

      const response = await fetch(`/api/student/entries?${params.toString()}`)
      const data = await response.json().catch(() => ({ entries: [] }))
      if (!response.ok) {
        const message = typeof data.error === 'string' ? data.error : 'Failed to load entries'
        throw new Error(message)
      }
      return data
    },
    STUDENT_ENTRIES_CACHE_TTL_MS,
  )

  return data.entries || []
}

export function invalidateStudentEntriesForClassroom(classroomId: string) {
  invalidateCachedJSONMatching(getStudentEntriesCachePrefix(classroomId))
}
