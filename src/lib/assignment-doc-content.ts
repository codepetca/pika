import { z } from 'zod'
import { areJsonDocumentsEqual } from '@/lib/json-patch'
import type { TiptapContent } from '@/types'

const managedIdSchema = z.string().uuid().transform((value) => value.toLowerCase())

function relativeProtectedImageId(src: unknown): string | null {
  if (typeof src !== 'string' || !src.startsWith('/') || src.startsWith('//')) return null
  try {
    const url = new URL(src, 'https://pika.invalid')
    if (url.origin !== 'https://pika.invalid' || url.pathname !== '/api/storage/submission-images') return null
    const ids = url.searchParams.getAll('object_id')
    if (ids.length !== 1 || url.searchParams.has('path')) return null
    const parsed = managedIdSchema.safeParse(ids[0])
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

function submissionComparisonContent(input: TiptapContent): TiptapContent {
  const content = structuredClone(input)
  const nodes = [...(content.content ?? [])]
  while (nodes.length) {
    const node = nodes.pop()!
    if (node.content) nodes.push(...node.content)
    if (node.type !== 'image' || !node.attrs) continue
    const attrs = node.attrs
    for (const key of ['managed_object_id', 'storage_bucket', 'storage_path']) {
      if (attrs[key] === null) delete attrs[key]
    }
    const sourceId = relativeProtectedImageId(attrs.src)
    const explicitId = managedIdSchema.safeParse(attrs.managed_object_id)
    // A supplied invalid or conflicting identity remains a real difference.
    if (attrs.managed_object_id !== undefined && !explicitId.success) continue
    if (explicitId.success && sourceId && explicitId.data !== sourceId) continue
    const id = explicitId.success ? explicitId.data : sourceId
    if (!id) continue
    attrs.managed_object_id = id
    attrs.src = `/api/storage/submission-images?object_id=${encodeURIComponent(id)}`
    delete attrs.storage_bucket
    delete attrs.storage_path
  }
  return content
}

/** Compare acknowledged submissions without mistaking repaired image metadata for new edits. */
export function areSubmittedAssignmentContentsEqual(left: TiptapContent, right: TiptapContent): boolean {
  return areJsonDocumentsEqual(submissionComparisonContent(left), submissionComparisonContent(right))
}
