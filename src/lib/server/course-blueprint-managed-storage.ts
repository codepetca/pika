import { createHash } from 'node:crypto'
import type { TestDocument } from '@/types'
import {
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'

type SupabaseLike = any
type AssessmentLike = { documents: TestDocument[] }

export type BlueprintManagedStorageCopyResult<T extends AssessmentLike> = {
  assessments: T[]
  cleanupObjectIds: string[]
}

function deterministicBlueprintCopyUuid(seed: string): string {
  const hex = createHash('sha256')
    .update(`pika.managed-storage-blueprint-copy:v1:${seed}`)
    .digest('hex')
    .slice(0, 32)
    .split('')
  hex[12] = '5'
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)
  return [
    hex.slice(0, 8).join(''),
    hex.slice(8, 12).join(''),
    hex.slice(12, 16).join(''),
    hex.slice(16, 20).join(''),
    hex.slice(20, 32).join(''),
  ].join('-')
}

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
}): Promise<BlueprintManagedStorageCopyResult<T>> {
  const managedDocuments = input.assessments.flatMap((assessment) =>
    assessment.documents.filter((document) => document.source === 'upload'),
  )
  if (managedDocuments.length === 0) {
    return { assessments: input.assessments, cleanupObjectIds: [] }
  }

  if (input.direction === 'to_blueprint') {
    if (!input.sourceClassroomId || input.sourceCourseBlueprintId) {
      throw new Error('managed_storage_blueprint_copy_source_owner_invalid')
    }
  } else if (!input.sourceCourseBlueprintId || input.sourceClassroomId) {
    throw new Error('managed_storage_blueprint_copy_source_owner_invalid')
  }

  const protocol = await input.supabase.rpc('managed_storage_blueprint_protocol_ready', {})
  if (protocol.error) {
    if (isMissingFoundation(protocol.error)) {
      return { assessments: input.assessments, cleanupObjectIds: [] }
    }
    throw new Error('managed_storage_blueprint_protocol_check_failed')
  }
  if (protocol.data !== true) {
    return { assessments: input.assessments, cleanupObjectIds: [] }
  }

  const sourceIdByDocument = new Map<TestDocument, string>()
  const sourceById = new Map<string, any>()
  for (const document of managedDocuments) {
    const sourcePath = testDocumentStoragePath(document.url || '')
    if (!document.managed_object_id && !sourcePath) {
      throw new Error('managed_storage_blueprint_copy_source_identity_missing')
    }
    const sourceResponse = await input.supabase.rpc(
      'resolve_managed_storage_blueprint_copy_source',
      {
        p_teacher_id: input.teacherId,
        p_storage_path: sourcePath,
        p_classroom_id: input.sourceClassroomId || null,
        p_course_blueprint_id: input.sourceCourseBlueprintId || null,
        p_managed_object_id: document.managed_object_id || null,
      },
    )
    if (sourceResponse.error || !sourceResponse.data) {
      throw new Error('managed_storage_blueprint_copy_source_invalid')
    }
    const ownerMatches = input.direction === 'to_blueprint'
      ? sourceResponse.data.classroom_id === input.sourceClassroomId
        && sourceResponse.data.course_blueprint_id === null
      : sourceResponse.data.course_blueprint_id === input.sourceCourseBlueprintId
        && sourceResponse.data.classroom_id === null
    if (sourceResponse.data.storage_bucket !== 'test-documents'
      || sourceResponse.data.storage_path !== sourcePath
      || sourceResponse.data.status !== 'ready'
      || sourceResponse.data.provisional_owner_id !== null
      || !ownerMatches
      || (document.managed_object_id
        && sourceResponse.data.id !== document.managed_object_id)) {
      throw new Error('managed_storage_blueprint_copy_source_invalid')
    }
    sourceIdByDocument.set(document, sourceResponse.data.id)
    sourceById.set(sourceResponse.data.id, sourceResponse.data)
  }

  const targetBySourceId = new Map<string, {
    objectId: string
    targetPath: string
    publicUrl: string
  }>()
  for (const [sourceId, source] of sourceById) {
    const objectId = deterministicBlueprintCopyUuid(
      `object:${input.operationId}:${input.direction}:${sourceId}`,
    )
    const extension = /\.[a-z0-9]{1,12}$/i.exec(source.storage_path)?.[0] || ''
    const targetPath = `managed-copies/${input.operationId}/${objectId}${extension}`
    targetBySourceId.set(sourceId, {
      objectId,
      targetPath,
      publicUrl: input.supabase.storage.from('test-documents')
        .getPublicUrl(targetPath).data.publicUrl,
    })
  }

  const buildAssessments = () => input.assessments.map((assessment) => ({
    ...assessment,
    documents: assessment.documents.map((document) => {
      const sourceId = sourceIdByDocument.get(document)
      if (!sourceId) return document
      const target = targetBySourceId.get(sourceId) as {
        objectId: string
        publicUrl: string
      }
      return {
        ...document,
        url: target.publicUrl,
        managed_object_id: target.objectId,
      }
    }),
  }))

  const operationLookup = await input.supabase
    .from('course_blueprint_operations')
    .select('status')
    .eq('id', input.operationId)
    .eq('teacher_id', input.teacherId)
    .maybeSingle()
  if (operationLookup.error) {
    throw new Error('managed_storage_blueprint_operation_preflight_failed')
  }
  if (operationLookup.data?.status === 'completed') {
    return { assessments: buildAssessments(), cleanupObjectIds: [] }
  }

  const provisionalOwnerId = deterministicBlueprintCopyUuid(
    `owner:${input.operationId}:${input.direction}`,
  )
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
    if (isMissingFoundation(ownerResponse.error)) {
      return { assessments: input.assessments, cleanupObjectIds: [] }
    }
    throw new Error('managed_storage_blueprint_copy_owner_failed')
  }
  if (ownerResponse.data !== true) {
    throw new Error('managed_storage_blueprint_copy_owner_conflict')
  }

  const reservedObjectIds: string[] = []
  try {
    for (const sourceId of sourceById.keys()) {
      const source = sourceById.get(sourceId)
      const download = await input.supabase.storage
        .from('test-documents')
        .download(source.storage_path)
      if (download.error || !download.data) {
        throw new Error('managed_storage_blueprint_copy_source_missing')
      }
      const bytes = new Uint8Array(await download.data.arrayBuffer())
      const target = targetBySourceId.get(sourceId) as {
        objectId: string
        targetPath: string
      }
      const reservation = await reserveManagedStorageUpload({
        supabase: input.supabase,
        objectId: target.objectId,
        bucket: 'test-documents',
        path: target.targetPath,
        provisionalOwnerId,
        purpose: 'teacher_test_material',
        createdByUserId: input.teacherId,
        resourceType: 'course_blueprint_operation',
        resourceId: input.operationId,
        contentType: source.content_type || download.data.type || 'application/octet-stream',
        byteSize: bytes.byteLength,
      })
      if (!reservation) throw new Error('managed_storage_blueprint_copy_reservation_missing')
      reservedObjectIds.push(target.objectId)

      if (reservation.status === 'reserved') {
        const presence = await input.supabase.rpc('get_managed_storage_object_presence', {
          p_storage_bucket: 'test-documents',
          p_storage_path: target.targetPath,
        })
        if (presence.error) {
          throw new Error('managed_storage_blueprint_copy_presence_failed')
        }
        if (presence.data?.object_exists !== true) {
          const upload = await input.supabase.storage.from('test-documents').upload(
            target.targetPath,
            bytes,
            {
              contentType: source.content_type || download.data.type || 'application/octet-stream',
              upsert: false,
            },
          )
          if (upload.error) {
            const retryPresence = await input.supabase.rpc(
              'get_managed_storage_object_presence',
              {
                p_storage_bucket: 'test-documents',
                p_storage_path: target.targetPath,
              },
            )
            if (retryPresence.error || retryPresence.data?.object_exists !== true) {
              throw new Error('managed_storage_blueprint_copy_upload_failed')
            }
          }
        }
      }

      const readBack = await input.supabase.storage
        .from('test-documents')
        .download(target.targetPath)
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
        objectId: target.objectId,
        contentSha256: targetHash,
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

  return {
    assessments: buildAssessments(),
    cleanupObjectIds: reservedObjectIds,
  }
}

export async function queueBlueprintManagedStorageCopiesBestEffort(input: {
  supabase: SupabaseLike
  objectIds: string[]
  errorCode: string
}): Promise<void> {
  await Promise.all(input.objectIds.map((objectId) =>
    queueManagedStorageCleanupBestEffort({
      supabase: input.supabase,
      objectId,
      errorCode: input.errorCode,
    }),
  ))
}
