import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { getServiceRoleClient } from '@/lib/supabase'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isValidDoc(value: unknown): value is TiptapContent {
  return !!value && typeof value === 'object' && (value as TiptapContent).type === 'doc'
}

function isMissingMaterialsTableError(error: any) {
  return error?.code === 'PGRST205' || String(error?.message || '').includes('classwork_materials')
}

export const GET = withErrorHandler('GetTeacherClassworkMaterials', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const supabase = getServiceRoleClient()
  const { data: materials, error } = await supabase
    .from('classwork_materials')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingMaterialsTableError(error)) {
      return NextResponse.json({ materials: [] })
    }
    console.error('Error fetching classwork materials:', error)
    return NextResponse.json({ error: 'Failed to fetch materials' }, { status: 500 })
  }

  return NextResponse.json({ materials: materials || [] })
})

export const POST = withErrorHandler('PostTeacherClassworkMaterial', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const body = await request.json()
  const { title, content, is_draft: isDraft = true } = body as {
    title?: string
    content?: unknown
    is_draft?: boolean
  }

  const cleanTitle = title?.trim()
  if (!cleanTitle) {
    return NextResponse.json({ error: 'Title is required' }, { status: 400 })
  }

  if (!isValidDoc(content)) {
    return NextResponse.json({ error: 'Invalid content format' }, { status: 400 })
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const supabase = getServiceRoleClient()
  const { data: material, error } = await supabase
    .from('classwork_materials')
    .insert({
      classroom_id: classroomId,
      title: cleanTitle,
      content,
      is_draft: !!isDraft,
      released_at: isDraft ? null : new Date().toISOString(),
      created_by: user.id,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating classwork material:', error)
    return NextResponse.json({ error: 'Failed to create material' }, { status: 500 })
  }

  return NextResponse.json({ material }, { status: 201 })
})
