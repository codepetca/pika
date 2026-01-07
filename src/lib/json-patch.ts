import { applyPatch, compare } from 'fast-json-patch'
import type { JsonPatchOperation, TiptapContent } from '@/types'

function cloneContent(content: TiptapContent): TiptapContent {
  return JSON.parse(JSON.stringify(content)) as TiptapContent
}

export function createJsonPatch(before: TiptapContent, after: TiptapContent): JsonPatchOperation[] {
  return compare(before, after) as JsonPatchOperation[]
}

export function applyJsonPatch(
  base: TiptapContent,
  patch: JsonPatchOperation[]
): TiptapContent {
  const cloned = cloneContent(base)
  try {
    const result = applyPatch(cloned, patch, true, false)
    return result.newDocument as TiptapContent
  } catch (error) {
    console.error('Error applying JSON patch:', error)
    return cloned
  }
}

export function shouldStoreSnapshot(
  patch: JsonPatchOperation[],
  content: TiptapContent,
  thresholdRatio = 0.5
): boolean {
  const patchSize = JSON.stringify(patch).length
  const snapshotSize = JSON.stringify(content).length
  if (snapshotSize === 0) return true
  return patchSize > snapshotSize * thresholdRatio
}
