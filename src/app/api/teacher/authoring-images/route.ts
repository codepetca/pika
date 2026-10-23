import { NextResponse } from 'next/server'
import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { authoringImageReservationSchema, authoringImageIdentitySchema, authoringImageUrl, validateStoredAuthoringImage } from '@/lib/server/authoring-images'
import { assertDirectUploadMatchesReservation, createManagedUploadAuthorization } from '@/lib/server/direct-storage-delivery'
import { reserveManagedStorageUpload, verifyManagedStorageUpload, queueManagedStorageCleanupBestEffort } from '@/lib/server/managed-storage'

export const dynamic = 'force-dynamic'
async function owner(classroomId: string) {
  const user = await requireRole('teacher')
  const access = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!access.ok) throw new ApiError(access.status, access.error)
  return { user, db: getServiceRoleClient() }
}
export const POST = withErrorHandler('ReserveTeacherAuthoringImage', async request => {
  const input = authoringImageReservationSchema.parse(await request.json())
  const { user, db } = await owner(input.classroom_id)
  const id = crypto.randomUUID(), extension = input.content_type === 'image/jpeg' ? 'jpg' : input.content_type.split('/')[1]
  const path = `classrooms/${input.classroom_id}/authoring-images/${id}.${extension}`
  await reserveManagedStorageUpload({ supabase: db, objectId: id, bucket: 'test-documents', path,
    classroomId: input.classroom_id, purpose: 'teacher_authoring_image', createdByUserId: user.id,
    resourceType: 'classroom', resourceId: input.classroom_id, contentType: input.content_type, byteSize: input.byte_size })
  try {
    const authorization = await createManagedUploadAuthorization({ supabase: db, bucket: 'test-documents', path })
    return NextResponse.json({ bucket: 'test-documents', storage_path: path, managed_object_id: id, upload_url: authorization.signedUrl })
  } catch (error) {
    await queueManagedStorageCleanupBestEffort({ supabase: db, objectId: id, errorCode: 'authoring_image_signing_failed' }); throw error
  }
})
export const PATCH = withErrorHandler('FinalizeTeacherAuthoringImage', async request => {
  const input = authoringImageIdentitySchema.parse(await request.json())
  const { user, db } = await owner(input.classroom_id)
  const result = await db.from('managed_storage_objects')
    .select('id,storage_bucket,storage_path,purpose,classroom_id,resource_type,resource_id,created_by_user_id,status,content_type,byte_size')
    .eq('id', input.managed_object_id).maybeSingle()
  const object = result.data
  if (result.error || !object || object.purpose !== 'teacher_authoring_image' || object.storage_bucket !== 'test-documents'
    || object.classroom_id !== input.classroom_id || object.resource_type !== 'classroom' || object.resource_id !== input.classroom_id
    || object.created_by_user_id !== user.id || !['reserved', 'verified', 'ready'].includes(object.status)) throw new ApiError(404, 'Image upload not found')
  const metadata = authoringImageReservationSchema.safeParse({ classroom_id: input.classroom_id, file_name: 'image', content_type: object.content_type, byte_size: object.byte_size })
  if (!metadata.success) throw new ApiError(400, 'Invalid image upload')
  if (object.status === 'reserved') {
    await assertDirectUploadMatchesReservation({ supabase: db, bucket: 'test-documents', path: object.storage_path, expectedByteSize: metadata.data.byte_size, expectedContentType: metadata.data.content_type })
    await validateStoredAuthoringImage(object.storage_path, metadata.data.content_type)
    await verifyManagedStorageUpload({ supabase: db, objectId: object.id })
  }
  // Keep it verified until the same transaction that saves authored Markdown
  // attaches the reference and marks it ready. Unused uploads expire normally.
  return NextResponse.json({ url: authoringImageUrl(object.id), managed_object_id: object.id })
})
const cancellation = z.object({ managed_object_id: z.string().uuid() }).strict()
export const DELETE = withErrorHandler('CancelTeacherAuthoringImage', async request => {
  const user = await requireRole('teacher'), input = cancellation.parse(await request.json()), db = getServiceRoleClient()
  const { data: object, error } = await db.from('managed_storage_objects').select('id,purpose,created_by_user_id,status,classroom_id').eq('id', input.managed_object_id).maybeSingle()
  if (error) throw new ApiError(503, 'Unable to cancel image upload')
  if (object && object.created_by_user_id === user.id && object.purpose === 'teacher_authoring_image' && object.status === 'reserved') {
    // Do not queue from this stale read: a concurrent finalization may already
    // have made the image ready. Existing reservation expiry owns cancellation.
    if (object.classroom_id) await assertTeacherCanMutateClassroom(user.id, object.classroom_id)
  }
  return new NextResponse(null, { status: 204 })
})
