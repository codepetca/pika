import { getServiceRoleClient } from '@/lib/supabase'
import {
  getTestDocumentStoragePath,
  isAllowedTestDocumentType,
  normalizeTestDocuments,
} from '@/lib/test-documents'
import { getPrivateStorageContentType } from '@/lib/server/direct-storage-delivery'
import type { TestDocument } from '@/types'

/** Add verified MIME types for display without trusting document JSON or filenames. */
export async function resolveTestDocumentUploadContentTypes(
  value: unknown,
  classroomId: string,
  supabase: ReturnType<typeof getServiceRoleClient> = getServiceRoleClient(),
): Promise<TestDocument[]> {
  const documents = normalizeTestDocuments(value).map((doc) =>
    doc.source === 'upload' ? { ...doc, upload_content_type: undefined } : doc,
  )
  const uploads = documents.filter((doc) => doc.source === 'upload')
  if (uploads.length === 0) return documents

  const paths = uploads
    .map(getTestDocumentStoragePath)
    .filter((path): path is string => Boolean(path))
  if (paths.length === 0) return documents

  let objects: Array<{ id: string; storage_path: string; content_type: string | null }> | null
  try {
    const result = await supabase
      .from('managed_storage_objects')
      .select('id,storage_path,content_type')
      .eq('storage_bucket', 'test-documents')
      .eq('classroom_id', classroomId)
      .eq('purpose', 'teacher_test_material')
      .eq('status', 'ready')
      .is('provisional_owner_id', null)
      .in('storage_path', paths)
    if (result.error) return documents
    objects = result.data
  } catch {
    return documents
  }

  const objectsByPath = new Map((objects || []).map((object) => [object.storage_path, object]))
  return Promise.all(documents.map(async (doc) => {
    if (doc.source !== 'upload') return doc
    const path = getTestDocumentStoragePath(doc)
    if (!path) return doc
    const object = objectsByPath.get(path)
    if (object) {
      if (doc.managed_object_id && doc.managed_object_id !== object.id) return doc
      const contentType = object.content_type?.trim().toLowerCase()
      return contentType && isAllowedTestDocumentType(contentType)
        ? { ...doc, upload_content_type: contentType }
        : doc
    }
    if (doc.managed_object_id) return doc

    // Pre-managed uploads can still be served from a public compatibility bucket.
    let contentType: string | null
    try {
      contentType = await getPrivateStorageContentType({
        supabase,
        bucket: 'test-documents',
        path,
      })
    } catch {
      return doc
    }
    return contentType && isAllowedTestDocumentType(contentType)
      ? { ...doc, upload_content_type: contentType }
      : doc
  }))
}
