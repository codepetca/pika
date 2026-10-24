import type { SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { ApiError } from '@/lib/api-error'
import { parsePublicStoragePath } from '@/lib/managed-storage-urls'
import type { TiptapContent, TiptapNode } from '@/types'
import type { Database, TableRow } from '@/types/database'

type ImageRecord = Pick<TableRow<'managed_storage_objects'>,
  'id' | 'storage_bucket' | 'storage_path' | 'status' | 'purpose' | 'classroom_id'
  | 'data_subject_user_id' | 'resource_type' | 'resource_id'>

const uuid = z.string().uuid().transform((value) => value.toLowerCase())
const unavailableImage = () => new ApiError(400, 'An image could not be verified for this assignment. Your saved work has not changed.')

function protectedReference(src: unknown, origin: string): { id?: string; path?: string } {
  if (typeof src !== 'string') return {}
  let url: URL
  try { url = new URL(src, origin) } catch { return {} }
  if (url.origin === origin && url.pathname === '/api/storage/submission-images') {
    const ids = url.searchParams.getAll('object_id')
    const paths = url.searchParams.getAll('path')
    if (ids.length === 1 && paths.length === 0) {
      const parsed = uuid.safeParse(ids[0])
      if (!parsed.success) throw unavailableImage()
      return { id: parsed.data }
    }
    if (paths.length === 1 && ids.length === 0 && paths[0]) return { path: paths[0] }
    throw unavailableImage()
  }
  const path = parsePublicStoragePath(src, 'submission-images')
  return path ? { path } : {}
}

/**
 * Repair clipboard omissions before building the atomic save/history payload.
 * No images or text are removed. Registry evidence is scoped to this exact
 * student/document/Classroom; the database still validates ownership at write.
 */
export async function normalizeAssignmentDocImageReferences(input: {
  supabase: Pick<SupabaseClient<Database>, 'from'>
  content: TiptapContent
  assignmentDocId: string | null
  studentId: string
  classroomId?: string
  origin: string
}): Promise<TiptapContent> {
  const content = structuredClone(input.content)
  const pending: Array<{ attrs: Record<string, unknown>; id?: string; path?: string }> = []
  const nodes: TiptapNode[] = [...(content.content ?? [])]
  while (nodes.length) {
    const node = nodes.pop()!
    if (node.content) nodes.push(...node.content)
    if (node.type !== 'image' || !node.attrs) continue
    const attrs = node.attrs as Record<string, unknown>
    // Tiptap emits null defaults for ordinary external images. The legacy SQL
    // identity walker interprets an explicit null ID as a reference to validate.
    for (const key of ['managed_object_id', 'storage_bucket', 'storage_path']) {
      if (attrs[key] === null) delete attrs[key]
    }
    const source = protectedReference(attrs.src, input.origin)
    let id: string | undefined
    if (attrs.managed_object_id !== undefined) {
      const parsed = uuid.safeParse(attrs.managed_object_id)
      if (!parsed.success) throw unavailableImage()
      id = parsed.data
      if (source.id && source.id !== id) throw unavailableImage()
    } else {
      id = source.id
    }
    if (id && attrs.storage_bucket && attrs.storage_path && attrs.managed_object_id) continue
    const path = typeof attrs.storage_path === 'string' && attrs.storage_bucket === 'submission-images'
      ? attrs.storage_path : source.path
    if (id || path) pending.push({ attrs, ...(id ? { id } : { path }) })
  }
  if (pending.length === 0) return content
  if (!input.assignmentDocId) throw unavailableImage()

  const objects = new Map<string, {
    id: string; storage_bucket: string; storage_path: string
  }>()
  for (const key of ['id', 'storage_path'] as const) {
    const values = [...new Set(pending.flatMap((reference) => {
      const value = key === 'id' ? reference.id : reference.path
      return value ? [value] : []
    }))]
    for (let offset = 0; offset < values.length; offset += 100) {
      const result: { data: ImageRecord[] | null; error: unknown } = await input.supabase.from('managed_storage_objects')
        .select('id,storage_bucket,storage_path,status,purpose,classroom_id,data_subject_user_id,resource_type,resource_id')
        .eq('storage_bucket', 'submission-images')
        .eq('purpose', 'student_inline_image')
        .eq('data_subject_user_id', input.studentId)
        .eq('resource_type', 'assignment_doc')
        .eq('resource_id', input.assignmentDocId)
        .match(input.classroomId ? { classroom_id: input.classroomId } : {})
        .in(key, values.slice(offset, offset + 100))
      if (result.error || !result.data) throw new ApiError(503, 'Image verification is temporarily unavailable. Your saved work has not changed. Try again.')
      for (const object of result.data) {
        if (object.storage_bucket !== 'submission-images' || object.purpose !== 'student_inline_image'
          || !object.classroom_id || (input.classroomId && object.classroom_id !== input.classroomId)
          || object.data_subject_user_id !== input.studentId
          || object.resource_type !== 'assignment_doc' || object.resource_id !== input.assignmentDocId
          || !['verified', 'ready'].includes(object.status) || !object.storage_path) throw unavailableImage()
        objects.set(object.id, object)
        objects.set(object.storage_path, object)
      }
    }
  }
  for (const reference of pending) {
    const object = objects.get(reference.id ?? reference.path!)
    if (!object
      || (reference.attrs.storage_bucket !== undefined && reference.attrs.storage_bucket !== object.storage_bucket)
      || (reference.attrs.storage_path !== undefined && reference.attrs.storage_path !== object.storage_path)) throw unavailableImage()
    Object.assign(reference.attrs, {
      managed_object_id: object.id,
      storage_bucket: object.storage_bucket,
      storage_path: object.storage_path,
      src: `/api/storage/submission-images?object_id=${encodeURIComponent(object.id)}`,
    })
  }
  return content
}
