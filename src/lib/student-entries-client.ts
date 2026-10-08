import type { Entry } from '@/types'
import { fetchJSON, fetchJSONWithCache, invalidateCachedJSONMatching } from '@/lib/request-cache'

type StudentEntriesResponse = {
  entries: Entry[]
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

      const data = await fetchJSON<unknown>(`/api/student/entries?${params.toString()}`, {
        errorMessage: 'Failed to load entries',
      })
      if (!data || typeof data !== 'object' || !('entries' in data) || !Array.isArray(data.entries)) {
        throw new Error('Failed to load entries')
      }
      return { entries: data.entries as Entry[] }
    },
    STUDENT_ENTRIES_CACHE_TTL_MS,
  )

  return data.entries
}

export function invalidateStudentEntriesForClassroom(classroomId: string) {
  invalidateCachedJSONMatching(getStudentEntriesCachePrefix(classroomId))
}
