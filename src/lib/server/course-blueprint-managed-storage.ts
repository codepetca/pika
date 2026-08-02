import { createHash, randomUUID } from 'node:crypto'
import type { TestDocument } from '@/types'
import {
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'

type SupabaseLike = any
type AssessmentLike = { documents: TestDocument[] }

function testDocumentStoragePath(url: string): string | null {
  try {
    const marker = '/storage/v1/object/public/test-documents/'
    const parsed = new URL(url)
    if (!parsed.pathname.startsWith(marker)) return null
    const path = decodeURIComponent(parsed.pathname.slice(marker.length))
    return path && !path.startsWith('/') ? path : null
  } catch {
    return null
  }
}

function isMissingFoundation(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() || ''
  return error?.code === 'PGRST202' || error?.code === '42883'
    || message.includes('begin_managed_storage_provisional_owner')
}

export async function copyManagedTestDocumentsForBlueprintOperation<T extends AssessmentLike>(input: {
  supabase: SupabaseLike
  teacherId: string
  operationId: string
  direction: 'to_blueprint' | 'to_classroom'
  sourceClassroomId?: string
  sourceCourseBlueprintId?: string
  assessments: T[]
}): Promise<T[]> {
  const managedDocuments = input.assessments.flatMap((assessment) =>
    assessment.documents.filter((document) => document.source === 'upload'),
  )
  if (managedDocuments.length === 0) return input.assessments

  if (input.direction === 'to_blueprint') {
    if (!input.sourceClassroomId || input.sourceCourseBlueprintId) {
      throw new Error('managed_storage_blueprint_copy_source_owner_invalid')
    }
  } else if (!input.sourceCourseBlueprintId || input.sourceClassroomId) {
    throw new Error('managed_storage_blueprint_copy_source_owner_invalid')
  }

  const protocol = await input.supabase.rpc('managed_storage_blueprint_protocol_ready', {})
  if (protocol.error) {
    if (isMissingFoundation(protocol.error)) return input.assessments
    throw new Error('managed_storage_blueprint_protocol_check_failed')
  }
  if (protocol.data !== true) return input.assessments

  const sourceIdByDocument = new Map<TestDocument, string>()
  const sourceById = new Map<string, any>()
  for (const document of managedDocuments) {
    const sourcePath = testDocumentStoragePath(document.url || '')
    if (!document.managed_object_id && !sourcePath) {
      throw new Error('managed_storage_blueprint_copy_source_identity_missing')
    }
    let query = input.supabase
      .from('managed_storage_objects')
      .select('id,storage_bucket,storage_path,status,content_type,classroom_id,course_blueprint_id,provisional_owner_id')
      .eq('storage_bucket', 'test-documents')
      .eq('status', 'ready')
      .is('provisional_owner_id', null)
    query = document.managed_object_id
      ? query.eq('id', document.managed_object_id)
      : query.eq('storage_path', sourcePath)
    query = input.direction === 'to_blueprint'
      ? query.eq('classroom_id', input.sourceClassroomId)
      : query.eq('course_blueprint_id', input.sourceCourseBlueprintId)
    const sourceResponse = await query.single()
    if (sourceResponse.error || !sourceResponse.data
      || sourceResponse.data.storage_path !== sourcePath
      || (document.managed_object_id && sourceResponse.data.id !== document.managed_object_id)) {
      throw new Error('managed_storage_blueprint_copy_source_invalid')
    }
    sourceIdByDocument.set(document, sourceResponse.data.id)
    sourceById.set(sourceResponse.data.id, sourceResponse.data)
  }

  const provisionalOwnerId = randomUUID()
  const ownerResponse = await input.supabase.rpc('begin_managed_storage_provisional_owner', {
    p_owner_id: provisionalOwnerId,
    p_owner_kind: input.direction === 'to_blueprint'
      ? 'course_blueprint_copy'
      : 'classroom_copy',
    p_operation_id: input.operationId,
    p_created_by_user_id: input.teacherId,
    p_target_classroom_id: null,
    p_target_course_blueprint_id: null,
  })
  if (ownerResponse.error) {
    if (isMissingFoundation(ownerResponse.error)) return input.assessments
    throw new Error('managed_storage_blueprint_copy_owner_failed')
  }
  if (ownerResponse.data !== true) {
    throw new Error('managed_storage_blueprint_copy_owner_conflict')
  }

  const copiedBySourceId = new Map<string, TestDocument>()
  const reservedObjectIds: string[] = []
  try {
    for (const document of managedDocuments) {
      const sourceId = sourceIdByDocument.get(document) as string
      if (copiedBySourceId.has(sourceId)) continue
      const source = sourceById.get(sourceId)
      const download = await input.supabase.storage
        .from('test-documents')
        .download(source.storage_path)
      if (download.error || !download.data) {
        throw new Error('managed_storage_blueprint_copy_source_missing')
      }
      const bytes = new Uint8Array(await download.data.arrayBuffer())
      const objectId = randomUUID()
      const extension = /\.[a-z0-9]{1,12}$/i.exec(source.storage_path)?.[0] || ''
      const targetPath = `managed-copies/${input.operationId}/${objectId}${extension}`
      const reservation = await reserveManagedStorageUpload({
        supabase: input.supabase,
        objectId,
        bucket: 'test-documents',
        path: targetPath,
        provisionalOwnerId,
        purpose: 'teacher_test_material',
        createdByUserId: input.teacherId,
        resourceType: 'course_blueprint_operation',
        resourceId: input.operationId,
        contentType: source.content_type || download.data.type || 'application/octet-stream',
        byteSize: bytes.byteLength,
      })
      if (!reservation) throw new Error('managed_storage_blueprint_copy_reservation_missing')
      reservedObjectIds.push(objectId)
      const upload = await input.supabase.storage.from('test-documents').upload(
        targetPath,
        bytes,
        {
          contentType: source.content_type || download.data.type || 'application/octet-stream',
          upsert: false,
        },
      )
      if (upload.error) throw new Error('managed_storage_blueprint_copy_upload_failed')
      const readBack = await input.supabase.storage.from('test-documents').download(targetPath)
      if (readBack.error || !readBack.data) {
        throw new Error('managed_storage_blueprint_copy_readback_failed')
      }
      const readBackBytes = new Uint8Array(await readBack.data.arrayBuffer())
      const sourceHash = createHash('sha256').update(bytes).digest('hex')
      const targetHash = createHash('sha256').update(readBackBytes).digest('hex')
      if (sourceHash !== targetHash || bytes.byteLength !== readBackBytes.byteLength) {
        throw new Error('managed_storage_blueprint_copy_verification_failed')
      }
      await verifyManagedStorageUpload({
        supabase: input.supabase,
        objectId,
        contentSha256: targetHash,
      })
      const publicUrl = input.supabase.storage.from('test-documents')
        .getPublicUrl(targetPath).data.publicUrl
      copiedBySourceId.set(sourceId, {
        ...document,
        url: publicUrl,
        managed_object_id: objectId,
      })
    }
  } catch (error) {
    await Promise.all(reservedObjectIds.map((objectId) =>
      queueManagedStorageCleanupBestEffort({
        supabase: input.supabase,
        objectId,
        errorCode: 'blueprint_storage_copy_failed',
      }),
    ))
    throw error
  }

  return input.assessments.map((assessment) => ({
    ...assessment,
    documents: assessment.documents.map((document) => (
      sourceIdByDocument.has(document)
        ? copiedBySourceId.get(sourceIdByDocument.get(document) as string) || document
        : document
    )),
  }))
}
