import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { getServiceRoleClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function isMissingMaterialsTableError(error: any) {
  return error?.code === 'PGRST205' || String(error?.message || '').includes('classwork_materials')
}

function isMissingMaterialsPositionError(error: any) {
  const message = String(error?.message || '')
  return error?.code === 'PGRST204' || (message.includes('position') && message.includes('classwork_materials'))
}

export const GET = withErrorHandler('GetStudentClassworkMaterials', async (_request, context) => {
  const user = await requireRole('student')
  const { id: classroomId } = await context.params

  const access = await assertStudentCanAccessClassroom(user.id, classroomId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const ordered = await supabase
    .from('classwork_materials')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('is_draft', false)
    .order('position', { ascending: true })
    .order('released_at', { ascending: true })

  let materials = ordered.data
  let error = ordered.error

  if (error && isMissingMaterialsPositionError(error)) {
    const fallback = await supabase
      .from('classwork_materials')
      .select('*')
      .eq('classroom_id', classroomId)
      .eq('is_draft', false)
      .order('released_at', { ascending: false })
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
