import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function getKnownAssignmentReorderError(error: any) {
  const message = String(error?.message || '')

  if (message === 'Assignment list changed. Refresh and try again.') {
    return { status: 409, message }
  }

  if (
    message === 'assignment_ids must be an array' ||
    message === 'assignment_ids must include strings' ||
    message === 'assignment_ids must be unique' ||
    message === 'One or more assignments not found in classroom'
  ) {
    return { status: 400, message }
  }

  return null
}

// POST /api/teacher/assignments/reorder
// body: { classroom_id: string, assignment_ids: string[] }
export const POST = withErrorHandler('PostTeacherAssignmentsReorder', async (request, context) => {
  const user = await requireRole('teacher')
  const body = await request.json()
  const { classroom_id, assignment_ids } = body as {
    classroom_id?: string
    assignment_ids?: string[]
  }

  if (!classroom_id || !Array.isArray(assignment_ids)) {
    return NextResponse.json({ error: 'classroom_id and assignment_ids are required' }, { status: 400 })
  }

  const uniqueIds = Array.from(new Set(assignment_ids.filter(Boolean)))
  if (uniqueIds.length !== assignment_ids.length) {
    return NextResponse.json({ error: 'assignment_ids must be unique' }, { status: 400 })
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroom_id)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const supabase = getServiceRoleClient()

  const { error } = await supabase.rpc('reorder_assignments_preserve_materials', {
    p_classroom_id: classroom_id,
    p_assignment_ids: uniqueIds,
  })

  if (error) {
    const knownError = getKnownAssignmentReorderError(error)
    if (knownError) {
      return NextResponse.json({ error: knownError.message }, { status: knownError.status })
    }
    console.error('Error reordering assignments:', error)
    return NextResponse.json({ error: 'Failed to reorder assignments' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
})
