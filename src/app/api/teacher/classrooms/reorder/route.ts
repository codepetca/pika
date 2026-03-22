import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { getNextTeacherClassroomPosition } from '@/lib/server/classroom-order'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/classrooms/reorder
// body: { classroom_ids: string[] }
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()
    const { classroom_ids } = body as {
      classroom_ids?: string[]
    }

    if (!Array.isArray(classroom_ids)) {
      return NextResponse.json({ error: 'classroom_ids is required' }, { status: 400 })
    }

    const uniqueIds = Array.from(new Set(classroom_ids.filter(Boolean)))
    if (uniqueIds.length !== classroom_ids.length) {
      return NextResponse.json({ error: 'classroom_ids must be unique' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()
    const hasPositionColumn = await getNextTeacherClassroomPosition(supabase, user.id)
    if (hasPositionColumn === null) {
      return NextResponse.json(
        { error: 'Apply the classroom ordering migration before reordering classrooms' },
        { status: 409 }
      )
    }

    const { data: classrooms, error: classroomsError } = await supabase
      .from('classrooms')
      .select('id')
      .eq('teacher_id', user.id)
      .is('archived_at', null)

    if (classroomsError) {
      console.error('Error verifying classrooms:', classroomsError)
      return NextResponse.json({ error: 'Failed to verify classrooms' }, { status: 500 })
    }

    const activeIds = (classrooms || []).map((classroom) => classroom.id)
    const activeIdSet = new Set(activeIds)

    if (uniqueIds.length !== activeIds.length || uniqueIds.some((id) => !activeIdSet.has(id))) {
      return NextResponse.json(
        { error: 'classroom_ids must include every active classroom exactly once' },
        { status: 400 }
      )
    }

    const updates = uniqueIds.map((id, index) => ({ id, position: index }))
    const { error: updateError } = await supabase
      .from('classrooms')
      .upsert(updates, { onConflict: 'id' })

    if (updateError) {
      console.error('Error reordering classrooms:', updateError)
      return NextResponse.json({ error: 'Failed to reorder classrooms' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.error('Reorder classrooms error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
