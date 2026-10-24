import { z } from 'zod'
import { areJsonDocumentsEqual } from '@/lib/json-patch'
import { parsePublicStoragePath } from '@/lib/managed-storage-urls'
import type { TiptapContent, TiptapNode } from '@/types'

const managedIdSchema = z.string().uuid().transform((value) => value.toLowerCase())

type ComparisonOrigins = { origin?: string; publicStorageOrigin?: string }
type ImageReference = { id?: string; path?: string; invalid?: boolean }

function sourceReference(src: unknown, origins: ComparisonOrigins): ImageReference {
  if (typeof src !== 'string') return {}
  try {
    const origin = origins.origin ? new URL(origins.origin).origin : 'https://pika.invalid'
    const relative = src.startsWith('/') && !src.startsWith('//')
    const url = new URL(src, origin)
    if ((relative || origins.origin) && url.origin === origin && url.pathname === '/api/storage/submission-images') {
      const ids = url.searchParams.getAll('object_id')
      const paths = url.searchParams.getAll('path')
      if (ids.length === 1 && paths.length === 0) {
        const parsed = managedIdSchema.safeParse(ids[0])
        return parsed.success ? { id: parsed.data } : { invalid: true }
      }
      if (paths.length === 1 && ids.length === 0 && paths[0]) return { path: paths[0] }
      return { invalid: true }
    }
    if (origins.publicStorageOrigin && url.origin === new URL(origins.publicStorageOrigin).origin) {
      const path = parsePublicStoragePath(src, 'submission-images')
      if (path) return { path }
    }
    return {}
  } catch {
    return {}
  }
}

function imageAttributes(content: TiptapContent): Array<Record<string, unknown>> {
  const images: Array<Record<string, unknown>> = []
  const nodes: TiptapNode[] = [...(content.content ?? [])]
  while (nodes.length) {
    const node = nodes.pop()!
    if (node.content) nodes.push(...node.content)
    if (node.type === 'image' && node.attrs) images.push(node.attrs)
  }
  return images
}

function acknowledgedAliases(content: TiptapContent, origins: ComparisonOrigins) {
  const byPath = new Map<string, string | null>()
  const byId = new Map<string, string | null>()
  function add(map: Map<string, string | null>, key: string, value: string) {
    map.set(key, map.has(key) && map.get(key) !== value ? null : value)
  }
  for (const attrs of imageAttributes(content)) {
    const id = managedIdSchema.safeParse(attrs.managed_object_id)
    const path = attrs.storage_path
    if (!id.success || attrs.storage_bucket !== 'submission-images' || typeof path !== 'string' || !path) continue
    const source = sourceReference(attrs.src, origins)
    if (source.invalid || (source.id && source.id !== id.data) || (source.path && source.path !== path)) continue
    add(byPath, path, id.data)
    add(byId, id.data, path)
  }
  return {
    idForPath: (path: string) => {
      const id = byPath.get(path)
      return id && byId.get(id) === path ? id : null
    },
  }
}

function submissionComparisonContent(input: TiptapContent, origins: ComparisonOrigins, aliases: ReturnType<typeof acknowledgedAliases>): TiptapContent {
  const content = structuredClone(input)
  for (const attrs of imageAttributes(content)) {
    for (const key of ['managed_object_id', 'storage_bucket', 'storage_path']) {
      if (attrs[key] === null) delete attrs[key]
    }
    const source = sourceReference(attrs.src, origins)
    const explicitId = managedIdSchema.safeParse(attrs.managed_object_id)
    // A supplied invalid or conflicting identity remains a real difference.
    if (attrs.managed_object_id !== undefined && !explicitId.success) continue
    if (source.invalid || (explicitId.success && source.id && explicitId.data !== source.id)) continue
    if (attrs.storage_bucket !== undefined && attrs.storage_bucket !== 'submission-images') continue
    const paths = [source.path, attrs.storage_path].filter((value): value is string => typeof value === 'string')
    const id = explicitId.success ? explicitId.data : source.id ?? (paths[0] ? aliases.idForPath(paths[0]) : null)
    if (!id) continue
    if (paths.some((path) => aliases.idForPath(path) !== id)) continue
    attrs.managed_object_id = id
    attrs.src = `/api/storage/submission-images?object_id=${encodeURIComponent(id)}`
    delete attrs.storage_bucket
    delete attrs.storage_path
  }
  return content
}

/** Compare acknowledged submissions without mistaking repaired image metadata for new edits. */
export function areSubmittedAssignmentContentsEqual(left: TiptapContent, right: TiptapContent, origins: ComparisonOrigins = {}): boolean {
  const aliases = acknowledgedAliases(right, origins)
  return areJsonDocumentsEqual(submissionComparisonContent(left, origins, aliases), submissionComparisonContent(right, origins, aliases))
}
