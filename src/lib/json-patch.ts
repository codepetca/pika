import { applyPatch, compare } from 'fast-json-patch'
import type { JsonPatchOperation } from '@/types'

type JsonObject = object

function cloneContent<TContent extends JsonObject>(content: TContent): TContent {
  return JSON.parse(JSON.stringify(content)) as TContent
}

export function createJsonPatch<TContent extends JsonObject>(
  before: TContent,
  after: TContent
): JsonPatchOperation[] {
  return compare(before, after) as JsonPatchOperation[]
}

export function applyJsonPatch<TContent extends JsonObject>(
  base: TContent,
  patch: JsonPatchOperation[]
): TContent {
  const cloned = cloneContent(base)
  try {
    const result = applyPatch(cloned, patch, true, false)
    return result.newDocument as TContent
  } catch (error) {
    console.error('Error applying JSON patch:', error)
    return cloned
  }
}

export function tryApplyJsonPatch<TContent extends JsonObject>(
  base: TContent,
  patch: JsonPatchOperation[]
): { success: boolean; content: TContent } {
  const cloned = cloneContent(base)
  try {
    const result = applyPatch(cloned, patch, true, false)
    return { success: true, content: result.newDocument as TContent }
  } catch (error) {
    console.error('Error applying JSON patch:', error)
    return { success: false, content: cloned }
  }
}

export function shouldStoreSnapshot<TContent extends JsonObject>(
  patch: JsonPatchOperation[],
  content: TContent,
  thresholdRatio = 0.5
): boolean {
  const patchSize = JSON.stringify(patch).length
  const snapshotSize = JSON.stringify(content).length
  if (snapshotSize === 0) return true
  return patchSize > snapshotSize * thresholdRatio
}
