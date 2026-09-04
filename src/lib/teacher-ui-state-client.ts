import { fetchCachedJSON, fetchJSON, invalidateCachedJSON } from '@/lib/request-cache'

const cacheKey = (key: string) => `teacher-ui-state:${key}`

/**
 * Reads the current teacher's stored value for a UI-state key (see
 * src/lib/server/teacher-ui-state.ts). Returns null when nothing has been
 * stored yet.
 */
export async function readTeacherUiState<T>(key: string): Promise<T | null> {
  const params = new URLSearchParams({ key })
  const { value } = await fetchCachedJSON<{ value: T | null }>(
    cacheKey(key),
    `/api/teacher/ui-state?${params.toString()}`,
    { errorMessage: 'UI state is temporarily unavailable' },
  )
  return value
}

/**
 * Upserts the current teacher's value for a UI-state key and refreshes the
 * local cache for that key.
 */
export async function writeTeacherUiState<T extends object>(key: string, value: T): Promise<void> {
  await fetchJSON('/api/teacher/ui-state', {
    init: {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    },
    errorMessage: 'Failed to save UI state',
  })
  invalidateCachedJSON(cacheKey(key))
}
