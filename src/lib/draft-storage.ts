/**
 * Draft storage for student daily entries
 *
 * Prevents data loss by saving drafts to localStorage.
 * Drafts are scoped by classroomId + date.
 */

export interface DraftEntry {
  classroomId: string
  date: string
  text: string
  savedAt: number
}

const DRAFT_KEY_PREFIX = 'pika_entry_draft'

/**
 * Generate a localStorage key for a specific classroom + date
 */
function getDraftKey(classroomId: string, date: string): string {
  return `${DRAFT_KEY_PREFIX}_${classroomId}_${date}`
}

/**
 * Save a draft to localStorage
 */
export function saveDraft(draft: Omit<DraftEntry, 'savedAt'>): void {
  if (typeof window === 'undefined') return

  const fullDraft: DraftEntry = {
    ...draft,
    savedAt: Date.now(),
  }

  const key = getDraftKey(draft.classroomId, draft.date)

  try {
    localStorage.setItem(key, JSON.stringify(fullDraft))
  } catch (err) {
    console.error('Failed to save draft:', err)
  }
}

/**
 * Load a draft from localStorage
 *
 * @param classroomId - Classroom ID
 * @param date - Date in YYYY-MM-DD format
 * @param serverUpdatedAt - Optional server entry update timestamp (to compare freshness)
 * @returns Draft text if found and fresher than server, otherwise null
 */
export function loadDraft(
  classroomId: string,
  date: string,
  serverUpdatedAt?: string | null
): { text: string; isDraftNewer: boolean } | null {
  if (typeof window === 'undefined') return null

  const key = getDraftKey(classroomId, date)

  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null

    const draft: DraftEntry = JSON.parse(raw)

    // Validate structure
    if (
      typeof draft.text !== 'string' ||
      typeof draft.savedAt !== 'number' ||
      draft.classroomId !== classroomId ||
      draft.date !== date
    ) {
      return null
    }

    // If we have a server entry, check if draft is newer
    if (serverUpdatedAt) {
      const serverTimestamp = new Date(serverUpdatedAt).getTime()
      const isDraftNewer = draft.savedAt > serverTimestamp

      return {
        text: draft.text,
        isDraftNewer,
      }
    }

    // No server entry, draft is always valid
    return {
      text: draft.text,
      isDraftNewer: true,
    }
  } catch (err) {
    console.error('Failed to load draft:', err)
    return null
  }
}

/**
 * Clear a draft from localStorage
 */
export function clearDraft(classroomId: string, date: string): void {
  if (typeof window === 'undefined') return

  const key = getDraftKey(classroomId, date)

  try {
    localStorage.removeItem(key)
  } catch (err) {
    console.error('Failed to clear draft:', err)
  }
}

/**
 * Clear all drafts (useful for cleanup or testing)
 */
export function clearAllDrafts(): void {
  if (typeof window === 'undefined') return

  try {
    const keys = Object.keys(localStorage)
    for (const key of keys) {
      if (key.startsWith(DRAFT_KEY_PREFIX)) {
        localStorage.removeItem(key)
      }
    }
  } catch (err) {
    console.error('Failed to clear all drafts:', err)
  }
}
