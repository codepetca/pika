import { NextRequest, NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { getServiceRoleClient } from '@/lib/supabase'
import { getNextTeacherClassroomPosition } from '@/lib/server/classroom-order'
import { isClassroomExperienceAdmissionConfigured } from '@/lib/server/classroom-experience-admission'
import { authorizeSharedClassroomMetadataActor } from '@/lib/server/contextual-classroom-metadata'
import { reorderContextualClassroomList } from '@/lib/server/contextual-classroom-list-reorder'
import { contextualClassroomListReorderSchema } from '@/lib/validations/contextual-classroom-list-reorder'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/classrooms/reorder
// body: { classroom_ids: string[] }
export const POST = withErrorHandler('PostTeacherClassroomsReorder', async (request: NextRequest) => {
  if (isClassroomExperienceAdmissionConfigured()) {
    const admission = await authorizeSharedClassroomMetadataActor()
    const actor = admission.mode === 'shared' ? admission.user : await requireRole('teacher')
    const input = contextualClassroomListReorderSchema.parse(await request.json())
    await reorderContextualClassroomList({supabase:getServiceRoleClient(),actorId:actor.id,classroomIds:input.classroom_ids})
    return NextResponse.json({success:true})
  }
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

  const results = await Promise.all(
    uniqueIds.map((id, index) =>
      supabase.from('classrooms').update({ position: index }).eq('id', id)
    )
  )
  const updateError = results.find((r) => r.error)?.error ?? null

  if (updateError) {
    console.error('Error reordering classrooms:', updateError)
    return NextResponse.json({ error: 'Failed to reorder classrooms' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
})
