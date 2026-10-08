import type { LogSummaryActionItem } from '@/types'

/** Keep display names concise while retaining full names for log navigation. */
export function formatLogSummaryItems(items: LogSummaryActionItem[], firstNames: Record<string, string> = {}) {
  return items.map((item) => {
    const rosterFirstName = Object.hasOwn(firstNames, item.studentName) ? firstNames[item.studentName] : ''
    const firstName = rosterFirstName.trim() || item.studentName.trim().split(/\s+/)[0]
    const detail = (item.detail ?? (item.text.startsWith(item.studentName)
      ? item.text.slice(item.studentName.length).trim()
      : item.text)).trim()
    return { ...item, firstName, detail: detail.charAt(0).toLowerCase() + detail.slice(1) }
  })
}
