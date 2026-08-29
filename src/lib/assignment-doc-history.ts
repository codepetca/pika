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

interface BlockMatch {
  beforeIndex: number
  afterIndex: number
}

const MAX_LCS_CELLS = 40_000

function findGreedyMatches(
  beforeSignatures: string[],
  afterSignatures: string[],
  beforeStart: number,
  beforeEnd: number,
  afterStart: number,
  afterEnd: number,
): BlockMatch[] {
  const afterPositions = new Map<string, number[]>()
  for (let afterIndex = afterStart; afterIndex < afterEnd; afterIndex += 1) {
    const signature = afterSignatures[afterIndex]!
    const positions = afterPositions.get(signature) ?? []
    positions.push(afterIndex)
    afterPositions.set(signature, positions)
  }

  const matches: BlockMatch[] = []
  let nextAfterIndex = afterStart
  for (let beforeIndex = beforeStart; beforeIndex < beforeEnd; beforeIndex += 1) {
    const positions = afterPositions.get(beforeSignatures[beforeIndex]!)
    if (!positions) continue

    let low = 0
    let high = positions.length
    while (low < high) {
      const middle = Math.floor((low + high) / 2)
      if (positions[middle]! < nextAfterIndex) low = middle + 1
      else high = middle
    }

    const afterIndex = positions[low]
    if (afterIndex === undefined) continue
    matches.push({ beforeIndex, afterIndex })
    nextAfterIndex = afterIndex + 1
  }

  return matches
}

function findMatchingBlocks(before: TiptapNode[], after: TiptapNode[]): BlockMatch[] {
  const beforeSignatures = before.map(nodeSignature)
  const afterSignatures = after.map(nodeSignature)
  const matches: BlockMatch[] = []
  let beforeStart = 0
  let afterStart = 0

  while (
    beforeStart < before.length
    && afterStart < after.length
    && beforeSignatures[beforeStart] === afterSignatures[afterStart]
  ) {
    matches.push({ beforeIndex: beforeStart, afterIndex: afterStart })
    beforeStart += 1
    afterStart += 1
  }

  let beforeEnd = before.length
  let afterEnd = after.length
  const suffixMatches: BlockMatch[] = []
  while (
    beforeEnd > beforeStart
    && afterEnd > afterStart
    && beforeSignatures[beforeEnd - 1] === afterSignatures[afterEnd - 1]
  ) {
    beforeEnd -= 1
    afterEnd -= 1
    suffixMatches.unshift({ beforeIndex: beforeEnd, afterIndex: afterEnd })
  }

  const beforeCount = beforeEnd - beforeStart
  const afterCount = afterEnd - afterStart
  if (beforeCount === 0 || afterCount === 0) {
    return [...matches, ...suffixMatches]
  }

  if (beforeCount * afterCount > MAX_LCS_CELLS) {
    return [
      ...matches,
      ...findGreedyMatches(
        beforeSignatures,
        afterSignatures,
        beforeStart,
        beforeEnd,
        afterStart,
        afterEnd,
      ),
      ...suffixMatches,
    ]
  }

  const lengths = Array.from(
    { length: beforeCount + 1 },
    () => new Uint16Array(afterCount + 1),
  )
  for (let beforeOffset = beforeCount - 1; beforeOffset >= 0; beforeOffset -= 1) {
    for (let afterOffset = afterCount - 1; afterOffset >= 0; afterOffset -= 1) {
      lengths[beforeOffset]![afterOffset] = (
        beforeSignatures[beforeStart + beforeOffset] === afterSignatures[afterStart + afterOffset]
      )
        ? 1 + lengths[beforeOffset + 1]![afterOffset + 1]!
        : Math.max(
            lengths[beforeOffset + 1]![afterOffset]!,
            lengths[beforeOffset]![afterOffset + 1]!,
          )
    }
  }

  let beforeOffset = 0
  let afterOffset = 0
  while (beforeOffset < beforeCount && afterOffset < afterCount) {
    if (
      beforeSignatures[beforeStart + beforeOffset]
      === afterSignatures[afterStart + afterOffset]
    ) {
      matches.push({
        beforeIndex: beforeStart + beforeOffset,
        afterIndex: afterStart + afterOffset,
      })
      beforeOffset += 1
      afterOffset += 1
    } else if (lengths[beforeOffset + 1]![afterOffset]! >= lengths[beforeOffset]![afterOffset + 1]!) {
      beforeOffset += 1
    } else {
      afterOffset += 1
    }
  }

  return [...matches, ...suffixMatches]
}

function formatBlockLocations(indexes: number[]) {
  const shown = indexes.slice(0, 3).map((index) => index + 1)
  const remaining = indexes.length - shown.length
  return `${shown.join(', ')}${remaining > 0 ? `, and ${remaining} more` : ''}`
}

export function describeAssignmentHistoryChange(change: AssignmentHistoryChange): string {
  const added = change.changedBlocks.filter(({ kind }) => kind === 'added')
  const modified = change.changedBlocks.filter(({ kind }) => kind === 'modified')
  const parts: string[] = []

  if (added.length > 0) {
    parts.push(
      `${added.length} added area${added.length === 1 ? '' : 's'} at document block ${formatBlockLocations(added.map(({ index }) => index))}`,
    )
  }
  if (modified.length > 0) {
    parts.push(
      `${modified.length} revised area${modified.length === 1 ? '' : 's'} at document block ${formatBlockLocations(modified.map(({ index }) => index))}`,
    )
  }
  if (change.deletionAnchors.length > 0) {
    const deletedCount = change.deletionAnchors.reduce((total, anchor) => total + anchor.count, 0)
    parts.push(
      `${deletedCount} deleted area${deletedCount === 1 ? '' : 's'} near document block ${formatBlockLocations(change.deletionAnchors.map(({ index }) => index))}`,
    )
  }

  return parts.length > 0
    ? `History preview: ${parts.join('; ')}.`
    : 'History preview: no changed document areas detected.'
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
