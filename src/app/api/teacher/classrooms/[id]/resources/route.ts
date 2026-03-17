import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import {
  assertTeacherOwnsClassroom,
  assertTeacherCanMutateClassroom,
} from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/classrooms/[id]/resources - Get resources for a classroom
export const GET = withErrorHandler('GetClassroomResources', async (_request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params

  const ownership = await assertTeacherOwnsClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
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

// PUT /api/teacher/classrooms/[id]/resources - Upsert resources for a classroom
export const PUT = withErrorHandler('PutUpsertClassroomResources', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const body = await request.json()
  const { content } = body as { content: TiptapContent }

  if (!content || content.type !== 'doc') {
    return NextResponse.json(
      { error: 'Invalid content format' },
      { status: 400 }
    )
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()

  // Upsert: insert or update based on classroom_id unique constraint
  const { data: resources, error } = await supabase
    .from('classroom_resources')
    .upsert(
      {
        classroom_id: classroomId,
        content,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      {
        onConflict: 'classroom_id',
      }
    )
    .select()
    .single()

  if (error) {
    console.error('Error upserting resources:', error)
    return NextResponse.json(
      { error: 'Failed to save resources' },
      { status: 500 }
    )
  }

  return NextResponse.json({ resources })
})
