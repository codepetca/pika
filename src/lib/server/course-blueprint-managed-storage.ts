import { createHash } from 'node:crypto'
import type { TestDocument } from '@/types'
import { getTestDocumentStoragePath } from '@/lib/test-documents'
import {
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'

type SupabaseLike = any
type AssessmentLike = { documents: TestDocument[] }

class BlueprintCopyHeartbeatError extends Error {
  constructor(readonly retryable: boolean) {
    super('managed_storage_blueprint_copy_heartbeat_failed')
  }
}

type BlueprintCopyHeartbeatController = {
  assertHealthy: () => void
  stop: () => Promise<void>
}

export type BlueprintManagedStorageCopyResult<T extends AssessmentLike> = {
  assessments: T[]
  cleanupObjectIds: string[]
  provisionalOwnerId?: string
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

function isMissingFoundation(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message?.toLowerCase() || ''
  return error?.code === 'PGRST202' || error?.code === '42883'
    || message.includes('begin_managed_storage_provisional_owner')
}

function isMissingBlueprintCopyOwner(
  error: { code?: string; message?: string } | null,
): boolean {
  const message = error?.message?.toLowerCase() || ''
  return error?.code === 'PGRST202' || error?.code === '42883'
    || message.includes('begin_managed_storage_blueprint_copy_owner')
}

function isRetryableBlueprintCopyHeartbeatError(
  error: { code?: string; message?: string } | null,
): boolean {
  const code = error?.code?.toUpperCase() || ''
  const detail = `${error?.code || ''} ${error?.message || ''}`.toLowerCase()
  return code.startsWith('08')
    || ['40001', '40P01', '53300', '57014', '57P01', 'PGRST000', 'PGRST001', 'PGRST002']
      .includes(code)
    || detail.includes('timeout')
    || detail.includes('network')
    || detail.includes('connection')
    || detail.includes('fetch failed')
}

async function heartbeatBlueprintCopyOwner(input: {
  supabase: SupabaseLike
  provisionalOwnerId: string
  operationId: string
  teacherId: string
  sourceCourseBlueprintId?: string
}): Promise<void> {
  if (!input.sourceCourseBlueprintId) return
  let response
  try {
    response = await input.supabase.rpc(
      'heartbeat_managed_storage_blueprint_copy_owner',
      {
        p_owner_id: input.provisionalOwnerId,
        p_operation_id: input.operationId,
        p_created_by_user_id: input.teacherId,
        p_source_course_blueprint_id: input.sourceCourseBlueprintId,
      },
    )
  } catch {
    throw new BlueprintCopyHeartbeatError(true)
  }
  if (response.error && isMissingBlueprintCopyOwner(response.error)) return
  if (response.error) {
    throw new BlueprintCopyHeartbeatError(
      isRetryableBlueprintCopyHeartbeatError(response.error),
    )
  }
  if (response.data !== true) {
    throw new BlueprintCopyHeartbeatError(false)
  }
}

async function startBlueprintCopyHeartbeat(input: {
  supabase: SupabaseLike
  provisionalOwnerId: string
  operationId: string
  teacherId: string
  sourceCourseBlueprintId?: string
}): Promise<BlueprintCopyHeartbeatController> {
  if (!input.sourceCourseBlueprintId) {
    return { assertHealthy: () => undefined, stop: async () => undefined }
  }
  await heartbeatBlueprintCopyOwner(input)
  let inFlight = Promise.resolve()
  let latestHeartbeatError: unknown
  let terminalHeartbeatError: unknown
  let stopped = false
  const timer = setInterval(() => {
    if (stopped || terminalHeartbeatError) return
    inFlight = inFlight
      .then(async () => {
        try {
          await heartbeatBlueprintCopyOwner(input)
          latestHeartbeatError = undefined
        } catch (error) {
          latestHeartbeatError = error
          if (error instanceof BlueprintCopyHeartbeatError && !error.retryable) {
            terminalHeartbeatError = error
          }
        }
      })
  }, 5 * 60 * 1000)
  ;(timer as unknown as { unref?: () => void }).unref?.()

  return {
    assertHealthy: () => {
      if (terminalHeartbeatError) throw terminalHeartbeatError
    },
    stop: async () => {
      if (!stopped) {
        stopped = true
        clearInterval(timer)
      }
      await inFlight
      if (terminalHeartbeatError) throw terminalHeartbeatError
      if (latestHeartbeatError) throw latestHeartbeatError
    },
  }
}

async function runWithBlueprintCopyHeartbeat<T>(
  heartbeat: BlueprintCopyHeartbeatController,
  action: () => T,
): Promise<Awaited<T>> {
  heartbeat.assertHealthy()
  const result = await action()
  heartbeat.assertHealthy()
  return result as Awaited<T>
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
    const sourcePath = getTestDocumentStoragePath(document)
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
    })
  }

  const buildAssessments = () => input.assessments.map((assessment) => ({
    ...assessment,
    documents: assessment.documents.map((document) => {
      const sourceId = sourceIdByDocument.get(document)
      if (!sourceId) return document
      const target = targetBySourceId.get(sourceId) as {
        objectId: string
        targetPath: string
      }
      return {
        ...document,
        url: undefined,
        storage_bucket: 'test-documents' as const,
        storage_path: target.targetPath,
        managed_object_id: target.objectId,
      }
    }),
  }))

  const provisionalOwnerId = deterministicBlueprintCopyUuid(
    `owner:${input.operationId}:${input.direction}`,
  )
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
    return {
      assessments: buildAssessments(),
      cleanupObjectIds: [],
      provisionalOwnerId: input.direction === 'to_classroom'
        ? provisionalOwnerId
        : undefined,
    }
  }

  let ownerResponse
  if (input.direction === 'to_classroom') {
    ownerResponse = await input.supabase.rpc(
      'begin_managed_storage_blueprint_copy_owner',
      {
        p_owner_id: provisionalOwnerId,
        p_operation_id: input.operationId,
        p_created_by_user_id: input.teacherId,
        p_source_course_blueprint_id: input.sourceCourseBlueprintId,
      },
    )
    // Deploying this application change before migration 120 remains safe:
    // the existing provisional-owner protocol is used until the source-aware
    // fence becomes available. Blueprint purge itself stays rollout-disabled.
    if (ownerResponse.error && isMissingBlueprintCopyOwner(ownerResponse.error)) {
      ownerResponse = await input.supabase.rpc('begin_managed_storage_provisional_owner', {
        p_owner_id: provisionalOwnerId,
        p_owner_kind: 'classroom_copy',
        p_operation_id: input.operationId,
        p_created_by_user_id: input.teacherId,
        p_target_classroom_id: null,
        p_target_course_blueprint_id: null,
      })
    }
  } else {
    ownerResponse = await input.supabase.rpc('begin_managed_storage_provisional_owner', {
      p_owner_id: provisionalOwnerId,
      p_owner_kind: 'course_blueprint_copy',
      p_operation_id: input.operationId,
      p_created_by_user_id: input.teacherId,
      p_target_classroom_id: null,
      p_target_course_blueprint_id: null,
    })
  }
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
  let heartbeat: BlueprintCopyHeartbeatController = {
    assertHealthy: () => undefined,
    stop: async () => undefined,
  }
  try {
    heartbeat = await startBlueprintCopyHeartbeat({
      supabase: input.supabase,
      provisionalOwnerId,
      operationId: input.operationId,
      teacherId: input.teacherId,
      sourceCourseBlueprintId: input.sourceCourseBlueprintId,
    })
    for (const sourceId of sourceById.keys()) {
      const source = sourceById.get(sourceId)
      const download = await runWithBlueprintCopyHeartbeat(
        heartbeat,
        () => input.supabase.storage.from('test-documents').download(source.storage_path),
      )
      if (download.error || !download.data) {
        throw new Error('managed_storage_blueprint_copy_source_missing')
      }
      const sourceBuffer = await runWithBlueprintCopyHeartbeat(
        heartbeat,
        () => download.data.arrayBuffer(),
      )
      const bytes = new Uint8Array(sourceBuffer)
      const target = targetBySourceId.get(sourceId) as {
        objectId: string
        targetPath: string
      }
      const reservation = await runWithBlueprintCopyHeartbeat(
        heartbeat,
        () => reserveManagedStorageUpload({
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
        }),
      )
      if (!reservation) throw new Error('managed_storage_blueprint_copy_reservation_missing')
      reservedObjectIds.push(target.objectId)

      if (reservation.status === 'reserved') {
        const presence = await runWithBlueprintCopyHeartbeat(
          heartbeat,
          () => input.supabase.rpc('get_managed_storage_object_presence', {
            p_storage_bucket: 'test-documents',
            p_storage_path: target.targetPath,
          }),
        )
        if (presence.error) {
          throw new Error('managed_storage_blueprint_copy_presence_failed')
        }
        if (presence.data?.object_exists !== true) {
          const upload = await runWithBlueprintCopyHeartbeat(
            heartbeat,
            () => input.supabase.storage.from('test-documents').upload(
              target.targetPath,
              bytes,
              {
                contentType: source.content_type || download.data.type || 'application/octet-stream',
                upsert: false,
              },
            ),
          )
          if (upload.error) {
            const retryPresence = await runWithBlueprintCopyHeartbeat(
              heartbeat,
              () => input.supabase.rpc('get_managed_storage_object_presence', {
                p_storage_bucket: 'test-documents',
                p_storage_path: target.targetPath,
              }),
            )
            if (retryPresence.error || retryPresence.data?.object_exists !== true) {
              throw new Error('managed_storage_blueprint_copy_upload_failed')
            }
          }
        }
      }

      const readBack = await runWithBlueprintCopyHeartbeat(
        heartbeat,
        () => input.supabase.storage.from('test-documents').download(target.targetPath),
      )
      if (readBack.error || !readBack.data) {
        throw new Error('managed_storage_blueprint_copy_readback_failed')
      }
      const readBackBuffer = await runWithBlueprintCopyHeartbeat(
        heartbeat,
        () => readBack.data.arrayBuffer(),
      )
      const readBackBytes = new Uint8Array(readBackBuffer)
      const sourceHash = createHash('sha256').update(bytes).digest('hex')
      const targetHash = createHash('sha256').update(readBackBytes).digest('hex')
      if (sourceHash !== targetHash || bytes.byteLength !== readBackBytes.byteLength) {
        throw new Error('managed_storage_blueprint_copy_verification_failed')
      }
      await runWithBlueprintCopyHeartbeat(
        heartbeat,
        () => verifyManagedStorageUpload({
          supabase: input.supabase,
          objectId: target.objectId,
          contentSha256: targetHash,
        }),
      )
    }
    await heartbeat.stop()
  } catch (error) {
    try { await heartbeat.stop() } catch { /* preserve the primary failure */ }
    await queueBlueprintManagedStorageCopiesBestEffort({
      supabase: input.supabase,
      objectIds: reservedObjectIds,
      errorCode: 'blueprint_storage_copy_failed',
      provisionalOwnerId,
      operationId: input.operationId,
      teacherId: input.teacherId,
      sourceCourseBlueprintId: input.sourceCourseBlueprintId,
      adopted: false,
    })
    throw error
  }

  return {
    assessments: buildAssessments(),
    cleanupObjectIds: reservedObjectIds,
    provisionalOwnerId,
  }
}

export async function queueBlueprintManagedStorageCopiesBestEffort(input: {
  supabase: SupabaseLike
  objectIds: string[]
  errorCode: string
  provisionalOwnerId?: string
  operationId?: string
  teacherId?: string
  sourceCourseBlueprintId?: string
  adopted?: boolean
}): Promise<void> {
  if (!input.adopted) {
    await Promise.all(input.objectIds.map((objectId) =>
      queueManagedStorageCleanupBestEffort({
        supabase: input.supabase,
        objectId,
        errorCode: input.errorCode,
      }),
    ))
  }
  if (!input.provisionalOwnerId || !input.operationId || !input.teacherId
    || !input.sourceCourseBlueprintId) return
  const response = await input.supabase.rpc(
    'settle_managed_storage_blueprint_copy_owner',
    {
      p_owner_id: input.provisionalOwnerId,
      p_operation_id: input.operationId,
      p_created_by_user_id: input.teacherId,
      p_source_course_blueprint_id: input.sourceCourseBlueprintId,
      p_outcome: input.adopted ? 'adopted' : 'aborted',
    },
  )
  if (response.error && isMissingBlueprintCopyOwner(response.error)) return
  if (response.error || response.data !== true) {
    throw new Error('managed_storage_blueprint_copy_settlement_failed')
  }
}
