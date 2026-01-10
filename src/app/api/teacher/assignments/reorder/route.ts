import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/reorder
// body: { classroom_id: string, assignment_ids: string[] }
export async function POST(request: NextRequest) {
  try {
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

    // Verify all IDs belong to the classroom
    const { data: assignments, error: assignmentsError } = await supabase
      .from('assignments')
      .select('id')
      .eq('classroom_id', classroom_id)
      .in('id', uniqueIds)

    if (assignmentsError) {
      console.error('Error verifying assignments:', assignmentsError)
      return NextResponse.json({ error: 'Failed to verify assignments' }, { status: 500 })
    }

    if ((assignments || []).length !== uniqueIds.length) {
      return NextResponse.json({ error: 'One or more assignments not found in classroom' }, { status: 400 })
    }

    const updates = uniqueIds.map((id, index) => ({ id, position: index }))
    const { error: updateError } = await supabase.from('assignments').upsert(updates, { onConflict: 'id' })

    if (updateError) {
      console.error('Error reordering assignments:', updateError)
      return NextResponse.json({ error: 'Failed to reorder assignments' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Reorder assignments error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
