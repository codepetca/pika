import { z } from 'zod'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import { requireAuth } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { isRetainedAuthoringImage, memberCanReadAuthoringImage } from '@/lib/server/authoring-images'
import { buildPrivateStorageRedirect } from '@/lib/server/direct-storage-delivery'

export const dynamic = 'force-dynamic'
export const revalidate = 0
const query = z.object({ object_id: z.string().uuid() }).strict()
export const GET = withErrorHandler('ReadTeacherAuthoringImage', async request => {
  const user = await requireAuth(), input = query.parse(Object.fromEntries(new URL(request.url).searchParams)), db = getServiceRoleClient()
  const { data: object, error } = await db.from('managed_storage_objects')
    .select('id,purpose,status,storage_bucket,storage_path,classroom_id,resource_type,resource_id,content_type,byte_size,cleanup_reason_code,attempt_count,next_attempt_at,lease_token,lease_expires_at,verified_at,ready_at')
    .eq('id', input.object_id).maybeSingle()
  if (error || !object || object.purpose !== 'teacher_authoring_image'
    || (!['verified', 'ready'].includes(object.status) && !isRetainedAuthoringImage(object))
    || object.storage_bucket !== 'test-documents' || !object.classroom_id
    || object.resource_type !== 'classroom' || object.resource_id !== object.classroom_id) throw new ApiError(404, 'Image not found')
  if (user.role === 'teacher') {
    const access = await assertTeacherOwnsClassroom(user.id, object.classroom_id)
    if (!access.ok) throw new ApiError(404, 'Image not found')
  } else if (user.role === 'student') {
    const access = await assertStudentCanAccessClassroom(user.id, object.classroom_id)
    if (object.status !== 'ready' || !access.ok || !await memberCanReadAuthoringImage(object.classroom_id, user.id, object.id)) throw new ApiError(404, 'Image not found')
  } else throw new ApiError(404, 'Image not found')
  return buildPrivateStorageRedirect({ supabase: db, bucket: 'test-documents', path: object.storage_path })
})
