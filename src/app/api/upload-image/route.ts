import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getImageValidationError } from '@/lib/image-upload'
import { ApiError, withErrorHandler } from '@/lib/api-handler'
import {
  adoptManagedStorageUpload,
  queueManagedStorageCleanup,
  reserveManagedStorageUpload,
} from '@/lib/server/managed-storage'
import { assignmentInlineImageUploadMetadataSchema } from '@/lib/validations/managed-storage'

export const dynamic = 'force-dynamic'

export const POST = withErrorHandler('PostUploadImage', async (request: NextRequest) => {
  const user = await requireRole('student')

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    throw new ApiError(400, 'No file provided')
  }

  // Validate file type and size
  const validationError = getImageValidationError(file)
  if (validationError) {
    throw new ApiError(400, validationError)
  }
  const metadata = assignmentInlineImageUploadMetadataSchema.parse({
    assignment_doc_id: formData.get('assignment_doc_id'),
  })

  const supabase = getServiceRoleClient()
  const { data: assignmentDoc, error: assignmentDocError } = await supabase
    .from('assignment_docs')
    .select('id,student_id,assignment_id')
    .eq('id', metadata.assignment_doc_id)
    .eq('student_id', user.id)
    .maybeSingle()
  if (assignmentDocError) {
    throw new ApiError(500, 'Failed to verify assignment document')
  }
  if (!assignmentDoc) {
    throw new ApiError(404, 'Assignment document not found')
  }
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('id,classroom_id')
    .eq('id', assignmentDoc.assignment_id)
    .maybeSingle()
  if (assignmentError) {
    throw new ApiError(500, 'Failed to verify assignment')
  }
  if (!assignment) {
    throw new ApiError(404, 'Assignment not found')
  }

  // Generate unique filename
  const ext = file.name.split('.').pop() || 'png'
  const objectId = crypto.randomUUID()
  const filename = `classrooms/${assignment.classroom_id}/students/${user.id}/assignment-docs/${assignmentDoc.id}/${objectId}.${ext}`

  await reserveManagedStorageUpload({
    supabase,
    objectId,
    bucket: 'submission-images',
    path: filename,
    classroomId: assignment.classroom_id,
    purpose: 'student_inline_image',
    createdByUserId: user.id,
    dataSubjectUserId: user.id,
    resourceType: 'assignment_doc',
    resourceId: assignmentDoc.id,
    contentType: file.type,
    byteSize: file.size,
  })

  // Convert File to ArrayBuffer then to Buffer for upload
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Upload to Supabase storage
  const { error: uploadError } = await supabase.storage
    .from('submission-images')
    .upload(filename, buffer, {
      contentType: file.type,
      upsert: false,
    })

  if (uploadError) {
    await queueManagedStorageCleanup({
      supabase,
      objectId,
      errorCode: 'submission_image_upload_failed',
    })
    console.error('Upload error:', uploadError)
    throw new ApiError(500, 'Failed to upload image')
  }

  try {
    await adoptManagedStorageUpload({ supabase, objectId })
  } catch (error) {
    await queueManagedStorageCleanup({
      supabase,
      objectId,
      errorCode: 'submission_image_adoption_failed',
    })
    throw error
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('submission-images')
    .getPublicUrl(filename)

  return NextResponse.json({
    url: urlData.publicUrl,
    managed_object_id: objectId,
  })
})
