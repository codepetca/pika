import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getImageValidationError } from '@/lib/image-upload'
import { ApiError, withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'

export const POST = withErrorHandler('PostUploadImage', async (request: NextRequest) => {
  const user = await requireAuth()
  if (!user.id) {
    throw new ApiError(401, 'Unauthorized')
  }

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

  const supabase = getServiceRoleClient()

  // Generate unique filename
  const ext = file.name.split('.').pop() || 'png'
  const filename = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`

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
    console.error('Upload error:', uploadError)
    throw new ApiError(500, 'Failed to upload image')
  }

  // Get public URL
  const { data: urlData } = supabase.storage
    .from('submission-images')
    .getPublicUrl(filename)

  return NextResponse.json({ url: urlData.publicUrl })
})
