import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isValidDoc(value: unknown): value is TiptapContent {
  return !!value && typeof value === 'object' && (value as TiptapContent).type === 'doc'
}

async function verifyMaterialOwnership(userId: string, classroomId: string, materialId: string) {
  const supabase = getServiceRoleClient()
  const { data: material, error } = await supabase
    .from('classwork_materials')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', materialId)
    .eq('classroom_id', classroomId)
    .single()

  if (error || !material) {
    return { ok: false as const, status: 404, error: 'Material not found' }
  }

  if (material.classrooms.teacher_id !== userId) {
    return { ok: false as const, status: 403, error: 'Unauthorized' }
  }

  return { ok: true as const, material, isArchived: !!material.classrooms.archived_at }
}

export const PATCH = withErrorHandler('PatchTeacherClassworkMaterial', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId, materialId } = await context.params
  const body = await request.json()
  const { title, content, is_draft: isDraft } = body as {
    title?: string
    content?: unknown
    is_draft?: boolean
  }

  if (title === undefined && content === undefined && isDraft === undefined) {
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 })
  }

  const cleanTitle = title?.trim()
  if (title !== undefined && !cleanTitle) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  if (content !== undefined && !isValidDoc(content)) {
    return NextResponse.json({ error: 'Invalid content format' }, { status: 400 })
  }

  const ownership = await verifyMaterialOwnership(user.id, classroomId, materialId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  if (ownership.isArchived) {
    return NextResponse.json({ error: 'Classroom is archived' }, { status: 403 })
  }

  const updateData: {
    title?: string
    content?: TiptapContent
    is_draft?: boolean
    released_at?: string | null
  } = {}

  if (cleanTitle !== undefined) updateData.title = cleanTitle
  if (content !== undefined) updateData.content = content
  if (isDraft !== undefined) {
    updateData.is_draft = !!isDraft
    updateData.released_at = isDraft
      ? null
      : ownership.material.released_at || new Date().toISOString()
  }

  const supabase = getServiceRoleClient()
  const { data: material, error } = await supabase
    .from('classwork_materials')
    .update(updateData)
    .eq('id', materialId)
    .select()
    .single()

  if (error) {
    console.error('Error updating classwork material:', error)
    return NextResponse.json({ error: 'Failed to update material' }, { status: 500 })
  }

  return NextResponse.json({ material })
})

export const DELETE = withErrorHandler('DeleteTeacherClassworkMaterial', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId, materialId } = await context.params

  const ownership = await verifyMaterialOwnership(user.id, classroomId, materialId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  if (ownership.isArchived) {
    return NextResponse.json({ error: 'Classroom is archived' }, { status: 403 })
  }

  const supabase = getServiceRoleClient()
  const { error } = await supabase.from('classwork_materials').delete().eq('id', materialId)

  if (error) {
    console.error('Error deleting classwork material:', error)
    return NextResponse.json({ error: 'Failed to delete material' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
})
