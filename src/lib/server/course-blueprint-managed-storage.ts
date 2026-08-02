import { createHash, randomUUID } from 'node:crypto'
import type { TestDocument } from '@/types'
import {
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'

type SupabaseLike = any
type AssessmentLike = { documents: TestDocument[] }

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
  assessments: T[]
}): Promise<T[]> {
  const managedDocuments = input.assessments.flatMap((assessment) =>
    assessment.documents.filter((document) => (
      document.source === 'upload' && Boolean(document.managed_object_id)
    )),
  )
  if (managedDocuments.length === 0) return input.assessments

  const protocol = await input.supabase.rpc('managed_storage_blueprint_protocol_ready', {})
  if (protocol.error) {
    if (isMissingFoundation(protocol.error)) return input.assessments
    throw new Error('managed_storage_blueprint_protocol_check_failed')
  }
  if (protocol.data !== true) return input.assessments

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
      const sourceId = document.managed_object_id as string
      if (copiedBySourceId.has(sourceId)) continue
      const sourceResponse = await input.supabase
        .from('managed_storage_objects')
        .select('id,storage_bucket,storage_path,status,content_type')
        .eq('id', sourceId)
        .eq('status', 'ready')
        .single()
      if (sourceResponse.error || !sourceResponse.data
        || sourceResponse.data.storage_bucket !== 'test-documents') {
        throw new Error('managed_storage_blueprint_copy_source_invalid')
      }
      const source = sourceResponse.data
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
      document.managed_object_id
        ? copiedBySourceId.get(document.managed_object_id) || document
        : document
    )),
  }))
}
