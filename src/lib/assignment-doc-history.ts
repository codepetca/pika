import { applyJsonPatch } from '@/lib/json-patch'
import type { AssignmentDocHistoryEntry, TiptapContent } from '@/types'

export function reconstructAssignmentDocContent(
  entries: AssignmentDocHistoryEntry[],
  targetId: string
): TiptapContent | null {
  const targetIndex = entries.findIndex(entry => entry.id === targetId)
  if (targetIndex === -1) return null

  let snapshotIndex = -1
  for (let i = targetIndex; i >= 0; i -= 1) {
    if (entries[i]?.snapshot) {
      snapshotIndex = i
      break
    }
  }

  if (snapshotIndex === -1) return null

  let content = entries[snapshotIndex]!.snapshot as TiptapContent
  for (let i = snapshotIndex + 1; i <= targetIndex; i += 1) {
    const entry = entries[i]
    if (!entry) continue
    if (entry.snapshot) {
      content = entry.snapshot
      continue
    }
    if (entry.patch) {
      content = applyJsonPatch(content, entry.patch)
    }
  }

  return content
}
