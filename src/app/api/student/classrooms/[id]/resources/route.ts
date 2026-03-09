import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/classrooms/[id]/resources - Get resources for an enrolled classroom
export const GET = withErrorHandler('GetStudentResources', async (request, context) => {
  const user = await requireRole('student')
  const { id: classroomId } = await context.params

  const access = await assertStudentCanAccessClassroom(user.id, classroomId)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    )
  }

  const supabase = getServiceRoleClient()

  const { data: resources, error } = await supabase
    .from('classroom_resources')
    .select('*')
    .eq('classroom_id', classroomId)
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows returned
    console.error('Error fetching resources:', error)
    return NextResponse.json(
      { error: 'Failed to fetch resources' },
      { status: 500 }
    )
  }

  // Return resources or null (no resources yet)
  return NextResponse.json({ resources: resources || null })
})
