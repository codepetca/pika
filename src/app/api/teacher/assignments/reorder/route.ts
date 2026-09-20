import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import { authorizeContextualClassworkReorderRequest } from '@/lib/server/contextual-classwork-reorder-access'
import { reorderAssignmentsForOwner } from '@/lib/server/contextual-classwork-reorder'

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
  let bodyPromise: Promise<unknown> | null = null
  const readBody = () => {
    bodyPromise ??= request.json()
    return bodyPromise
  }
  const access = await authorizeContextualClassworkReorderRequest(async () => {
    const candidate = await readBody()
    return typeof candidate === 'object' && candidate !== null
      && typeof (candidate as { classroom_id?: unknown }).classroom_id === 'string'
      ? (candidate as { classroom_id: string }).classroom_id
      : ''
  })
  const body = await readBody()
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

  const supabase = getServiceRoleClient()

  if (access.mode === 'contextual') {
    await reorderAssignmentsForOwner({
      supabase,
      actorId: access.user.id,
      classroomId: access.classroomId,
      assignmentIds: uniqueIds,
    })
    return NextResponse.json({ success: true })
  }

  const ownership = await assertTeacherCanMutateClassroom(access.user.id, classroom_id)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

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
