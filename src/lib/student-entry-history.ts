import type { Entry } from '@/types'

export function getStudentEntryHistoryCacheKey(opts: {
  classroomId: string
  limit: number
}) {
  return `pika_student_entry_history:${opts.classroomId}:${opts.limit}`
}

export function getEntryPreview(text: string, maxChars = 150) {
  const normalized = text.trim().replace(/\s+/g, ' ')
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars).trimEnd()}…`
}

export function upsertEntryIntoHistory(
  entries: Entry[],
  entry: Entry,
  limit: number
) {
  const filtered = entries.filter(
    e => e.id !== entry.id && e.date !== entry.date
  )
  return [entry, ...filtered]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
}
