import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import {
  assertTeacherOwnsClassroom,
  assertTeacherCanMutateClassroom,
} from '@/lib/server/classrooms'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/classrooms/[id]/announcements - List announcements (newest first)
export const GET = withErrorHandler('GetAnnouncements', async (_request, context) => {
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

  const { data: announcements, error } = await supabase
    .from('announcements')
    .select('*')
    .eq('classroom_id', classroomId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching announcements:', error)
    return NextResponse.json(
      { error: 'Failed to fetch announcements' },
      { status: 500 }
    )
  }

  return NextResponse.json({ announcements: announcements || [] })
})

// POST /api/teacher/classrooms/[id]/announcements - Create announcement
export const POST = withErrorHandler('PostCreateAnnouncement', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: classroomId } = await context.params
  const body = await request.json()
  const { content, scheduled_for } = body as { content?: string; scheduled_for?: string }

  if (!content || !content.trim()) {
    return NextResponse.json(
      { error: 'Content is required' },
      { status: 400 }
    )
  }

  // Validate scheduled_for if provided
  if (scheduled_for) {
    const scheduledDate = new Date(scheduled_for)
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid scheduled date' },
        { status: 400 }
      )
    }
    if (scheduledDate <= new Date()) {
      return NextResponse.json(
        { error: 'Scheduled date must be in the future' },
        { status: 400 }
      )
    }
  }

  const ownership = await assertTeacherCanMutateClassroom(user.id, classroomId)
  if (!ownership.ok) {
    return NextResponse.json(
      { error: ownership.error },
      { status: ownership.status }
    )
  }

  const supabase = getServiceRoleClient()

  const { data: announcement, error } = await supabase
    .from('announcements')
    .insert({
      classroom_id: classroomId,
      content: content.trim(),
      created_by: user.id,
      scheduled_for: scheduled_for || null,
    })
    .select()
    .single()

  if (error) {
    console.error('Error creating announcement:', error)
    return NextResponse.json(
      { error: 'Failed to create announcement' },
      { status: 500 }
    )
  }

  return NextResponse.json({ announcement }, { status: 201 })
})
