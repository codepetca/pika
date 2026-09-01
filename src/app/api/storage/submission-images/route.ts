import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withErrorHandler } from '@/lib/api-handler'
import { requireAuth } from '@/lib/auth'
import { isAllowedImageType } from '@/lib/image-upload'
import {
  buildPublicStorageCompatibilityRedirect,
  buildPrivateStorageRedirect,
  getPrivateStorageContentType,
} from '@/lib/server/direct-storage-delivery'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const imageRequestSchema = z.object({
  object_id: z.string().uuid().optional(),
  path: z.string().trim().min(1).max(1024).optional(),
}).refine(
  (value) => Number(Boolean(value.object_id)) + Number(Boolean(value.path)) === 1,
  'Exactly one managed image identity is required',
)

export const GET = withErrorHandler('GetManagedSubmissionImage', async (request) => {
  const user = await requireAuth()
  const input = imageRequestSchema.parse(Object.fromEntries(new URL(request.url).searchParams))
  const supabase = getServiceRoleClient()

  let objectQuery = supabase
    .from('managed_storage_objects')
    .select('id,storage_path,status,purpose,classroom_id,created_by_user_id,data_subject_user_id,resource_type,resource_id,content_type')
    .eq('storage_bucket', 'submission-images')
  objectQuery = input.object_id
    ? objectQuery.eq('id', input.object_id)
    : objectQuery.eq('storage_path', input.path as string)
  const { data: object, error: objectError } = await objectQuery.maybeSingle()

  if (objectError) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  if (!object && input.path) {
    const contentType = await getPrivateStorageContentType({
      supabase,
      bucket: 'submission-images',
      path: input.path,
    })
    if (contentType && isAllowedImageType(contentType)) {
      const compatibilityResponse = await buildPublicStorageCompatibilityRedirect({
        supabase,
        bucket: 'submission-images',
        path: input.path,
      })
      if (compatibilityResponse) return compatibilityResponse
    }
  }

  if (!object || object.purpose !== 'student_inline_image'
    || object.resource_type !== 'assignment_doc' || !object.resource_id
    || !['verified', 'ready'].includes(object.status)) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  const { data: assignmentDoc, error: docError } = await supabase
    .from('assignment_docs')
    .select('id,student_id,assignment_id')
    .eq('id', object.resource_id)
    .maybeSingle()
  if (docError || !assignmentDoc || assignmentDoc.student_id !== object.data_subject_user_id) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('classroom_id')
    .eq('id', assignmentDoc.assignment_id)
    .maybeSingle()
  if (assignmentError || !assignment || assignment.classroom_id !== object.classroom_id) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  if (user.role === 'student') {
    if (assignmentDoc.student_id !== user.id || object.data_subject_user_id !== user.id) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }
    if (object.status === 'verified' && object.created_by_user_id !== user.id) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }
  } else if (user.role === 'teacher') {
    if (object.status !== 'ready') {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }
    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('teacher_id')
      .eq('id', assignment.classroom_id)
      .maybeSingle()
    if (classroomError || classroom?.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Image not found' }, { status: 404 })
    }
  } else {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  const contentType = await getPrivateStorageContentType({
    supabase,
    bucket: 'submission-images',
    path: object.storage_path,
    registeredContentType: object.content_type,
  })
  if (!contentType || !isAllowedImageType(contentType)) {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 })
  }

  return buildPrivateStorageRedirect({
    supabase,
    bucket: 'submission-images',
    path: object.storage_path,
  })
})
