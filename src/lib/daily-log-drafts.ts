import { isValidTiptapContent } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

export interface DailyLogDraft {
  studentId: string
  classroomId: string
  date: string
  content: TiptapContent
  entryId: string | null
  version: number
  updatedAt: string
}

const PREFIX = 'daily-log-draft:v2:'

export function dailyLogDraftKey(studentId: string, classroomId: string, date: string): string {
  return `${PREFIX}${studentId}:${classroomId}:${date}`
}

function isDraft(value: unknown): value is DailyLogDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Record<string, unknown>
  return typeof draft.studentId === 'string' &&
    typeof draft.classroomId === 'string' &&
    typeof draft.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.date) &&
    typeof draft.updatedAt === 'string' &&
    (draft.entryId === null || typeof draft.entryId === 'string') &&
    Number.isInteger(draft.version) &&
    typeof draft.version === 'number' && draft.version >= 1 &&
    isValidTiptapContent(draft.content)
}

export function readDailyLogDraft(studentId: string, classroomId: string, date: string): DailyLogDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(dailyLogDraftKey(studentId, classroomId, date))
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    return isDraft(value) && value.studentId === studentId && value.classroomId === classroomId && value.date === date
      ? value
      : null
  } catch {
    return null
  }
}

export function listDailyLogDrafts(studentId: string, classroomId: string, beforeDate: string): DailyLogDraft[] {
  if (typeof window === 'undefined') return []
  try {
    const prefix = `${PREFIX}${studentId}:${classroomId}:`
    const dates: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(prefix)) dates.push(key.slice(prefix.length))
    }
    return dates
      .filter(date => date < beforeDate)
      .map(date => readDailyLogDraft(studentId, classroomId, date))
      .filter((draft): draft is DailyLogDraft => draft !== null)
      .sort((left, right) => right.date.localeCompare(left.date))
  } catch {
    return []
  }
}

export function writeDailyLogDraft(draft: DailyLogDraft): boolean {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(
      dailyLogDraftKey(draft.studentId, draft.classroomId, draft.date),
      JSON.stringify(draft),
    )
    return true
  } catch {
    return false
  }
}

export function removeDailyLogDraft(studentId: string, classroomId: string, date: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(dailyLogDraftKey(studentId, classroomId, date))
  } catch {
    // Private browsing and storage policy can make local storage unavailable.
  }
}
