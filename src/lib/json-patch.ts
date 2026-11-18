import { applyPatch, compare } from 'fast-json-patch/index.mjs'
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

export function areJsonDocumentsEqual<TContent extends JsonObject>(
  left: TContent,
  right: TContent
): boolean {
  return compare(left, right).length === 0
}

export function applyJsonPatch<TContent extends JsonObject>(
  base: TContent,
  patch: JsonPatchOperation[]
): TContent {
  const cloned = cloneContent(base)
  try {
    const result = applyPatch(cloned, patch, true, false)
    return result.newDocument as TContent
  } catch {
    console.warn('Failed to apply JSON patch')
    return cloned
  }
}

export function tryApplyJsonPatch<TContent extends JsonObject>(
  base: TContent,
  patch: JsonPatchOperation[],
  options?: { maxContentBytes: number },
): { success: boolean; content: TContent } {
  const cloned = cloneContent(base)
  try {
    if (options) {
      const withinLimit = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength <= options.maxContentBytes
      if (!Number.isSafeInteger(options.maxContentBytes) || options.maxContentBytes < 1 || !withinLimit(cloned)) {
        return { success: false, content: cloned }
      }
      let content = cloned
      for (const operation of patch) {
        // Check every intermediate document: root-copy operations must not
        // amplify a small request exponentially before the final size check.
        content = applyPatch(content, [operation], true, false).newDocument as TContent
        if (!withinLimit(content)) return { success: false, content: cloned }
      }
      return { success: true, content }
    }
    const result = applyPatch(cloned, patch, true, false)
    return { success: true, content: result.newDocument as TContent }
  } catch {
    console.warn('Failed to apply JSON patch')
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
