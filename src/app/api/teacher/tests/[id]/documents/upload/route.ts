import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { getTestDocumentValidationError } from '@/lib/test-documents'

export const dynamic = 'force-dynamic'

function safeExtension(filename: string): string {
  const ext = filename.split('.').pop()?.trim().toLowerCase() || 'pdf'
  return ext.replace(/[^a-z0-9]/g, '') || 'pdf'
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: testId } = await params
    const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const validationError = getTestDocumentValidationError(file)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const supabase = getServiceRoleClient()
    const ext = safeExtension(file.name)
    const filename = `${user.id}/${testId}/${Date.now()}-${crypto.randomUUID()}.${ext}`
    const buffer = Buffer.from(await file.arrayBuffer())

    const { error: uploadError } = await supabase.storage
      .from('test-documents')
      .upload(filename, buffer, {
        contentType: file.type,
        upsert: false,
      })

    if (uploadError) {
      const details = `${uploadError.message || ''} ${(uploadError as { details?: string }).details || ''}`.toLowerCase()
      if (details.includes('bucket') || details.includes('not found')) {
        return NextResponse.json(
          { error: 'Test document uploads require migration 042 to be applied' },
          { status: 400 }
        )
      }
      console.error('Test document upload error:', uploadError)
      return NextResponse.json({ error: 'Failed to upload document' }, { status: 500 })
    }

    const { data: urlData } = supabase.storage.from('test-documents').getPublicUrl(filename)

    return NextResponse.json({
      url: urlData.publicUrl,
      title: file.name,
      mime_type: file.type,
      size: file.size,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Upload test document error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
