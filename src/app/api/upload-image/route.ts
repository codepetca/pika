import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireAuth } from '@/lib/auth'
import { IMAGE_MAX_SIZE, isAllowedImageType } from '@/lib/image-upload'
import {
  assertDirectUploadMatchesReservation,
  createManagedUploadAuthorization,
} from '@/lib/server/direct-storage-delivery'
import {
  queueManagedStorageCleanupBestEffort,
  reserveManagedStorageUpload,
  verifyManagedStorageUpload,
} from '@/lib/server/managed-storage'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const imageReservationSchema = z.object({
  assignment_doc_id: z.string().uuid(),
  file_name: z.string().trim().min(1).max(255),
  content_type: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  byte_size: z.number().int().positive().max(IMAGE_MAX_SIZE),
})

const imageFinalizationSchema = z.object({
  assignment_doc_id: z.string().uuid(),
  managed_object_id: z.string().uuid(),
})

const imageCancellationSchema = z.object({
  managed_object_id: z.string().uuid(),
})

function safeExtension(filename: string): string {
  const ext = filename.split('.').pop()?.trim().toLowerCase() || 'png'
  return ext.replace(/[^a-z0-9]/g, '') || 'png'
}

async function getOwnedAssignmentContext(userId: string, assignmentDocId: string) {
  const supabase = getServiceRoleClient()
  const { data: assignmentDoc, error: assignmentDocError } = await supabase
    .from('assignment_docs')
    .select('id,student_id,assignment_id')
    .eq('id', assignmentDocId)
    .eq('student_id', userId)
    .maybeSingle()
  if (assignmentDocError) throw new ApiError(500, 'Failed to verify assignment document')
  if (!assignmentDoc) throw new ApiError(404, 'Assignment document not found')

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('id,classroom_id')
    .eq('id', assignmentDoc.assignment_id)
    .maybeSingle()
  if (assignmentError) throw new ApiError(500, 'Failed to verify assignment')
  if (!assignment) throw new ApiError(404, 'Assignment not found')

  return { supabase, assignmentDoc, assignment }
}

export const POST = withErrorHandler('ReserveUploadImage', async (request: NextRequest) => {
  const user = await requireAuth()
  if (!user.id) throw new ApiError(401, 'Unauthorized')
  const input = imageReservationSchema.parse(await request.json())
  const { supabase, assignmentDoc, assignment } = await getOwnedAssignmentContext(
    user.id,
    input.assignment_doc_id,
  )
  const objectId = crypto.randomUUID()
  const storagePath = `classrooms/${assignment.classroom_id}/students/${user.id}/assignment-docs/${assignmentDoc.id}/${objectId}.${safeExtension(input.file_name)}`
  const reservation = await reserveManagedStorageUpload({
    supabase,
    objectId,
    bucket: 'submission-images',
    path: storagePath,
    classroomId: assignment.classroom_id,
    purpose: 'student_inline_image',
    createdByUserId: user.id,
    dataSubjectUserId: user.id,
    resourceType: 'assignment_doc',
    resourceId: assignmentDoc.id,
    contentType: input.content_type,
    byteSize: input.byte_size,
  })
  if (!reservation) throw new ApiError(503, 'Managed image storage is unavailable')

  try {
    const uploadAuthorization = await createManagedUploadAuthorization({
      supabase,
      bucket: 'submission-images',
      path: storagePath,
    })
    return NextResponse.json({
      bucket: 'submission-images',
      storage_path: storagePath,
      upload_url: uploadAuthorization.signedUrl,
      managed_object_id: objectId,
    })
  } catch (error) {
    await queueManagedStorageCleanupBestEffort({
      supabase,
      objectId,
      errorCode: 'submission_image_signing_failed',
    })
    throw error
  }
})

export const PATCH = withErrorHandler('FinalizeUploadImage', async (request: NextRequest) => {
  const user = await requireAuth()
  if (!user.id) throw new ApiError(401, 'Unauthorized')
  const input = imageFinalizationSchema.parse(await request.json())
  const { supabase, assignmentDoc, assignment } = await getOwnedAssignmentContext(
    user.id,
    input.assignment_doc_id,
  )
  const { data: object, error } = await supabase
    .from('managed_storage_objects')
    .select('id,storage_bucket,storage_path,status,purpose,classroom_id,created_by_user_id,data_subject_user_id,resource_type,resource_id,content_type,byte_size')
    .eq('id', input.managed_object_id)
    .maybeSingle()
  if (error || !object || object.storage_bucket !== 'submission-images'
    || object.purpose !== 'student_inline_image' || object.classroom_id !== assignment.classroom_id
    || object.created_by_user_id !== user.id || object.data_subject_user_id !== user.id
    || object.resource_type !== 'assignment_doc' || object.resource_id !== assignmentDoc.id
    || !['reserved', 'verified'].includes(object.status)
    || !object.content_type || !isAllowedImageType(object.content_type)
    || typeof object.byte_size !== 'number' || object.byte_size > IMAGE_MAX_SIZE) {
    throw new ApiError(404, 'Image upload not found')
  }

  try {
    await assertDirectUploadMatchesReservation({
      supabase,
      bucket: 'submission-images',
      path: object.storage_path,
      expectedByteSize: object.byte_size,
      expectedContentType: object.content_type,
    })
    await verifyManagedStorageUpload({ supabase, objectId: object.id })
  } catch (finalizeError) {
    await queueManagedStorageCleanupBestEffort({
      supabase,
      objectId: object.id,
      errorCode: 'submission_image_verification_failed',
    })
    throw finalizeError
  }

  return NextResponse.json({
    url: `/api/storage/submission-images?object_id=${encodeURIComponent(object.id)}`,
    managed_object_id: object.id,
    storage_bucket: 'submission-images',
    storage_path: object.storage_path,
  })
})

export const DELETE = withErrorHandler('CancelUploadImage', async (request: NextRequest) => {
  const user = await requireAuth()
  if (!user.id) throw new ApiError(401, 'Unauthorized')
  const input = imageCancellationSchema.parse(await request.json())
  const supabase = getServiceRoleClient()
  const { data: object } = await supabase
    .from('managed_storage_objects')
    .select('id,created_by_user_id,purpose,status')
    .eq('id', input.managed_object_id)
    .maybeSingle()
  if (object?.created_by_user_id === user.id && object.purpose === 'student_inline_image'
    && object.status === 'reserved') {
    await queueManagedStorageCleanupBestEffort({
      supabase,
      objectId: object.id,
      errorCode: 'submission_image_client_upload_failed',
    })
  }
  return new NextResponse(null, { status: 204 })
})
