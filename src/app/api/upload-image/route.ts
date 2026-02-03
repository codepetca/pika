import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { getSession } from '@/lib/auth'
import { getImageValidationError } from '@/lib/image-upload'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    // Check authentication - any logged-in user can upload
    const session = await getSession()
    if (!session.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type and size
    const validationError = getImageValidationError(file)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'png'
    const filename = `${session.user.id}/${Date.now()}-${crypto.randomUUID()}.${ext}`

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
      return NextResponse.json(
        { error: 'Failed to upload image' },
        { status: 500 }
      )
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('submission-images')
      .getPublicUrl(filename)

    return NextResponse.json({ url: urlData.publicUrl })
  } catch (error) {
    console.error('Image upload error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
