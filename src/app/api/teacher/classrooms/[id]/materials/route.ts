import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom, assertTeacherOwnsClassroom } from '@/lib/server/classrooms'
import { getServiceRoleClient } from '@/lib/supabase'
import { isMissingSurveysTableError } from '@/lib/server/surveys'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isValidDoc(value: unknown): value is TiptapContent {
  return !!value && typeof value === 'object' && (value as TiptapContent).type === 'doc'
}

function isMissingMaterialsTableError(error: any) {
  return error?.code === 'PGRST205' || String(error?.message || '').includes('classwork_materials')
}

function isMissingMaterialsPositionError(error: any) {
  const message = String(error?.message || '')
  return error?.code === 'PGRST204' || (message.includes('position') && message.includes('classwork_materials'))
}

export const GET = withErrorHandler('GetTeacherClassworkMaterials', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const supabase = getServiceRoleClient()
  const ordered = await supabase
    .from('classwork_materials')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  let materials = ordered.data
  let error = ordered.error

  if (error && isMissingMaterialsPositionError(error)) {
    const fallback = await supabase
      .from('classwork_materials')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false })
    materials = fallback.data
    error = fallback.error
  }

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
  const [lastAssignmentResult, lastMaterialResult, lastSurveyResult] = await Promise.all([
    supabase
      .from('assignments')
      .select('position')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('classwork_materials')
      .select('position')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('surveys')
      .select('position')
      .eq('classroom_id', classroomId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  const lastAssignmentPosition = typeof lastAssignmentResult.data?.position === 'number'
    ? lastAssignmentResult.data.position
    : -1
  const lastMaterialPosition = !lastMaterialResult.error && typeof lastMaterialResult.data?.position === 'number'
    ? lastMaterialResult.data.position
    : -1
  const lastSurveyPosition = !lastSurveyResult.error && typeof lastSurveyResult.data?.position === 'number'
    ? lastSurveyResult.data.position
    : -1

  if (lastAssignmentResult.error) {
    console.error('Error fetching last assignment position:', lastAssignmentResult.error)
    return NextResponse.json({ error: 'Failed to create material' }, { status: 500 })
  }

  if (lastMaterialResult.error && !isMissingMaterialsPositionError(lastMaterialResult.error)) {
    console.error('Error fetching last material position:', lastMaterialResult.error)
    return NextResponse.json({ error: 'Failed to create material' }, { status: 500 })
  }

  if (lastSurveyResult.error && !isMissingSurveysTableError(lastSurveyResult.error)) {
    console.error('Error fetching last survey position:', lastSurveyResult.error)
    return NextResponse.json({ error: 'Failed to create material' }, { status: 500 })
  }

  const nextPosition = Math.max(lastAssignmentPosition, lastMaterialPosition, lastSurveyPosition) + 1
  const insertBody: Record<string, unknown> = {
    classroom_id: classroomId,
    title: cleanTitle,
    content,
    is_draft: !!isDraft,
    released_at: isDraft ? null : new Date().toISOString(),
    created_by: user.id,
  }

  if (!isMissingMaterialsPositionError(lastMaterialResult.error)) {
    insertBody.position = nextPosition
  }

  const { data: material, error } = await supabase
    .from('classwork_materials')
    .insert(insertBody)
    .select()
    .single()

  if (error) {
    console.error('Error creating classwork material:', error)
    return NextResponse.json({ error: 'Failed to create material' }, { status: 500 })
  }

  return NextResponse.json({ material }, { status: 201 })
})
