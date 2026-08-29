import { tryApplyJsonPatch } from '@/lib/json-patch'
import type { AssignmentDocHistoryEntry, TiptapContent, TiptapNode } from '@/types'

export type HistoryChangeKind = 'added' | 'modified'

export interface HistoryChangedBlock {
  index: number
  kind: HistoryChangeKind
}

export interface HistoryDeletionAnchor {
  index: number
  position: 'before' | 'after'
  count: number
}

export interface AssignmentHistoryChange {
  changedBlocks: HistoryChangedBlock[]
  deletionAnchors: HistoryDeletionAnchor[]
}

export interface AssignmentHistoryPreview {
  content: TiptapContent
  change: AssignmentHistoryChange
}

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
      const result = tryApplyJsonPatch(content, entry.patch)
      if (!result.success) {
        // Patch failed - return null to indicate reconstruction failure
        console.error('Failed to reconstruct history at entry:', entry.id)
        return null
      }
      content = result.content
    }
  }

  return content
}

function nodeSignature(node: TiptapNode): string {
  return JSON.stringify(node)
}

function findMatchingBlocks(before: TiptapNode[], after: TiptapNode[]) {
  const rows = before.length + 1
  const columns = after.length + 1
  const lengths = Array.from({ length: rows }, () => Array<number>(columns).fill(0))

  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      lengths[beforeIndex]![afterIndex] = nodeSignature(before[beforeIndex]!) === nodeSignature(after[afterIndex]!)
        ? 1 + lengths[beforeIndex + 1]![afterIndex + 1]!
        : Math.max(
            lengths[beforeIndex + 1]![afterIndex]!,
            lengths[beforeIndex]![afterIndex + 1]!,
          )
    }
  }

  const matches: Array<{ beforeIndex: number; afterIndex: number }> = []
  let beforeIndex = 0
  let afterIndex = 0
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (nodeSignature(before[beforeIndex]!) === nodeSignature(after[afterIndex]!)) {
      matches.push({ beforeIndex, afterIndex })
      beforeIndex += 1
      afterIndex += 1
    } else if (lengths[beforeIndex + 1]![afterIndex]! >= lengths[beforeIndex]![afterIndex + 1]!) {
      beforeIndex += 1
    } else {
      afterIndex += 1
    }
  }

  return matches
}

export function compareAssignmentDocContent(
  beforeContent: TiptapContent | null,
  afterContent: TiptapContent,
): AssignmentHistoryChange {
  const before = beforeContent?.content ?? []
  const after = afterContent.content ?? []
  const matches = findMatchingBlocks(before, after)
  const changedBlocks: HistoryChangedBlock[] = []
  const deletionAnchors: HistoryDeletionAnchor[] = []
  let beforeCursor = 0
  let afterCursor = 0

  for (const match of [...matches, { beforeIndex: before.length, afterIndex: after.length }]) {
    const removedCount = match.beforeIndex - beforeCursor
    const insertedCount = match.afterIndex - afterCursor
    const modifiedCount = Math.min(removedCount, insertedCount)

    for (let offset = 0; offset < modifiedCount; offset += 1) {
      changedBlocks.push({ index: afterCursor + offset, kind: 'modified' })
    }
    for (let offset = modifiedCount; offset < insertedCount; offset += 1) {
      changedBlocks.push({ index: afterCursor + offset, kind: 'added' })
    }

    const deletedOnlyCount = removedCount - modifiedCount
    if (deletedOnlyCount > 0) {
      const hasFollowingBlock = afterCursor + modifiedCount < after.length
      deletionAnchors.push({
        index: hasFollowingBlock
          ? afterCursor + modifiedCount
          : Math.max(0, after.length - 1),
        position: hasFollowingBlock ? 'before' : 'after',
        count: deletedOnlyCount,
      })
    }

    beforeCursor = match.beforeIndex + 1
    afterCursor = match.afterIndex + 1
  }

  return { changedBlocks, deletionAnchors }
}

export function buildAssignmentHistoryPreview(
  entries: AssignmentDocHistoryEntry[],
  targetId: string,
): AssignmentHistoryPreview | null {
  const targetIndex = entries.findIndex((entry) => entry.id === targetId)
  if (targetIndex === -1) return null

  const content = reconstructAssignmentDocContent(entries, targetId)
  if (!content) return null

  const previousContent = targetIndex > 0
    ? reconstructAssignmentDocContent(entries, entries[targetIndex - 1]!.id)
    : null

  return {
    content,
    change: compareAssignmentDocContent(previousContent, content),
  }
}
