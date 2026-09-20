import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { assertTeacherCanMutateClassroom } from '@/lib/server/classrooms'
import { getServiceRoleClient } from '@/lib/supabase'
import { authorizeContextualClassworkReorderRequest } from '@/lib/server/contextual-classwork-reorder-access'
import {
  reorderClassworkForOwner,
  type ContextualClassworkReorderItem,
} from '@/lib/server/contextual-classwork-reorder'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type ReorderItem = {
  type?: 'assignment' | 'material' | 'survey'
  id?: string
}

function getUniqueItemKeys(items: ReorderItem[]) {
  return items.map((item) => `${item.type}:${item.id}`)
}

function getKnownReorderError(error: any) {
  const message = String(error?.message || '')

  if (message === 'Classwork list changed. Refresh and try again.') {
    return { status: 409, message }
  }

  if (
    message === 'items must be an array' ||
    message === 'items must include type and id' ||
    message === 'items must be unique' ||
    message === 'One or more classwork items not found in classroom'
  ) {
    return { status: 400, message }
  }

  return null
}

export const POST = withErrorHandler('PostTeacherClassworkReorder', async (request, context) => {
  const access = await authorizeContextualClassworkReorderRequest(async () => (
    await context.params
  ).id)
  const classroomId = access.classroomId
  const body = await request.json()
  const items = (body as { items?: ReorderItem[] }).items

  if (!Array.isArray(items)) {
    return NextResponse.json({ error: 'items are required' }, { status: 400 })
  }

  const invalidItem = items.find((item) => (
    !item ||
    (item.type !== 'assignment' && item.type !== 'material' && item.type !== 'survey') ||
    typeof item.id !== 'string' ||
    item.id.length === 0
  ))
  if (invalidItem) {
    return NextResponse.json({ error: 'items must include type and id' }, { status: 400 })
  }

  const itemKeys = getUniqueItemKeys(items)
  if (new Set(itemKeys).size !== itemKeys.length) {
    return NextResponse.json({ error: 'items must be unique' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()

  if (access.mode === 'contextual') {
    await reorderClassworkForOwner({
      supabase,
      actorId: access.user.id,
      classroomId,
      items: items as ContextualClassworkReorderItem[],
    })
    return NextResponse.json({ success: true })
  }

  const ownership = await assertTeacherCanMutateClassroom(access.user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json({ error: ownership.error }, { status: ownership.status })
  }

  const { error } = await supabase.rpc('reorder_classwork_items', {
    p_classroom_id: classroomId,
    p_items: items,
  })

  if (error) {
    const knownError = getKnownReorderError(error)
    if (knownError) {
      return NextResponse.json({ error: knownError.message }, { status: knownError.status })
    }
    console.error('Error reordering classwork:', error)
    return NextResponse.json({ error: 'Failed to reorder classwork' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
})
