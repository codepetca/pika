import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import {
  assertDirectUploadMatchesReservation,
  createManagedUploadAuthorization,
} from '@/lib/server/direct-storage-delivery'
import {
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  TEST_DOCUMENT_MAX_SIZE,
  isAllowedTestDocumentType,
} from '@/lib/test-documents'

export const dynamic = 'force-dynamic'

const testDocumentReservationSchema = z.object({
  document_id: z.string().uuid(),
  file_name: z.string().trim().min(1).max(255),
  content_type: z.string().trim().min(1).refine(isAllowedTestDocumentType),
  byte_size: z.number().int().positive().max(TEST_DOCUMENT_MAX_SIZE),
})

const testDocumentFinalizationSchema = z.object({
  document_id: z.string().uuid(),
  managed_object_id: z.string().uuid(),
})

const testDocumentCancellationSchema = z.object({
  managed_object_id: z.string().uuid(),
})

function safeExtension(filename: string): string {
  const ext = filename.split('.').pop()?.trim().toLowerCase() || 'pdf'
  return ext.replace(/[^a-z0-9]/g, '') || 'pdf'
}

export const POST = withErrorHandler('ReserveTeacherTestDocument', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const input = testDocumentReservationSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const objectId = crypto.randomUUID()
  const storagePath = `classrooms/${access.test.classroom_id}/tests/${testId}/documents/${input.document_id}/${objectId}.${safeExtension(input.file_name)}`
  const reservation = await reserveManagedStorageUpload({
    supabase,
    objectId,
    bucket: 'test-documents',
    path: storagePath,
    classroomId: access.test.classroom_id,
    purpose: 'teacher_test_material',
    createdByUserId: user.id,
    resourceType: 'test',
    resourceId: testId,
    contentType: input.content_type,
    byteSize: input.byte_size,
  })
  if (!reservation) throw new ApiError(503, 'Managed test document storage is unavailable')

  try {
    const uploadAuthorization = await createManagedUploadAuthorization({
      supabase,
      bucket: 'test-documents',
      path: storagePath,
    })
    return NextResponse.json({
      bucket: 'test-documents',
      storage_path: storagePath,
      upload_url: uploadAuthorization.signedUrl,
      managed_object_id: objectId,
    })
  } catch (error) {
    await queueManagedStorageCleanupBestEffort({
      supabase,
      objectId,
      errorCode: 'test_document_signing_failed',
    })
    throw error
  }
})

export const PATCH = withErrorHandler('FinalizeTeacherTestDocument', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const input = testDocumentFinalizationSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const { data: object, error } = await supabase
    .from('managed_storage_objects')
    .select('id,storage_bucket,storage_path,status,purpose,classroom_id,created_by_user_id,resource_type,resource_id,content_type,byte_size')
    .eq('id', input.managed_object_id)
    .maybeSingle()
  const expectedPathPrefix = `classrooms/${access.test.classroom_id}/tests/${testId}/documents/${input.document_id}/`
  if (error || !object || object.storage_bucket !== 'test-documents'
    || object.purpose !== 'teacher_test_material' || object.classroom_id !== access.test.classroom_id
    || object.created_by_user_id !== user.id || object.resource_type !== 'test'
    || object.resource_id !== testId || !object.storage_path.startsWith(expectedPathPrefix)
    || !['reserved', 'verified'].includes(object.status)
    || !object.content_type || !isAllowedTestDocumentType(object.content_type)
    || typeof object.byte_size !== 'number' || object.byte_size > TEST_DOCUMENT_MAX_SIZE) {
    throw new ApiError(404, 'Test document upload not found')
  }

  try {
    await assertDirectUploadMatchesReservation({
      supabase,
      bucket: 'test-documents',
      path: object.storage_path,
      expectedByteSize: object.byte_size,
      expectedContentType: object.content_type,
    })
    await verifyManagedStorageUpload({ supabase, objectId: object.id })
  } catch (finalizeError) {
    await queueManagedStorageCleanupBestEffort({
      supabase,
      objectId: object.id,
      errorCode: 'test_document_verification_failed',
    })
    throw finalizeError
  }

  return NextResponse.json({
    document_id: input.document_id,
    storage_bucket: 'test-documents',
    storage_path: object.storage_path,
    managed_object_id: object.id,
  })
})

export const DELETE = withErrorHandler('CancelTeacherTestDocument', async (request) => {
  const user = await requireRole('teacher')
  const input = testDocumentCancellationSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const { data: object } = await supabase
    .from('managed_storage_objects')
    .select('id,created_by_user_id,purpose,status')
    .eq('id', input.managed_object_id)
    .maybeSingle()
  if (object?.created_by_user_id === user.id && object.purpose === 'teacher_test_material'
    && object.status === 'reserved') {
    await queueManagedStorageCleanupBestEffort({
      supabase,
      objectId: object.id,
      errorCode: 'test_document_client_upload_failed',
    })
  }
  return new NextResponse(null, { status: 204 })
})
