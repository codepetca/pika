import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// Helper to verify teacher owns the announcement's classroom
async function verifyAnnouncementOwnership(
  userId: string,
  classroomId: string,
  announcementId: string
) {
  const supabase = getServiceRoleClient()

  // Fetch announcement with classroom info
  const { data: announcement, error } = await supabase
    .from('announcements')
    .select(`
      *,
      classrooms!inner (
        id,
        teacher_id,
        archived_at
      )
    `)
    .eq('id', announcementId)
    .eq('classroom_id', classroomId)
    .single()

  if (error || !announcement) {
    return { ok: false as const, error: 'Announcement not found', status: 404 }
  }

  if (announcement.classrooms.teacher_id !== userId) {
    return { ok: false as const, error: 'Unauthorized', status: 403 }
  }

  return { ok: true as const, announcement, isArchived: !!announcement.classrooms.archived_at }
}

// PATCH /api/teacher/classrooms/[id]/announcements/[announcementId] - Update announcement
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; announcementId: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: classroomId, announcementId } = await params
    const body = await request.json()
    const { content, scheduled_for } = body as { content?: string; scheduled_for?: string | null }

    // Require at least one field to update
    if (content === undefined && scheduled_for === undefined) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      )
    }

    // Content can't be empty string if provided
    if (content !== undefined && (!content || !content.trim())) {
      return NextResponse.json(
        { error: 'Content cannot be empty' },
        { status: 400 }
      )
    }

    // Validate scheduled_for if provided and not null (null means publish immediately)
    if (scheduled_for !== undefined && scheduled_for !== null) {
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

    const ownership = await verifyAnnouncementOwnership(user.id, classroomId, announcementId)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    if (ownership.isArchived) {
      return NextResponse.json(
        { error: 'Classroom is archived' },
        { status: 403 }
      )
    }

    const supabase = getServiceRoleClient()

    // Build update object with only provided fields
    const updateData: { content?: string; scheduled_for?: string | null } = {}
    if (content !== undefined) {
      updateData.content = content.trim()
    }
    if (scheduled_for !== undefined) {
      updateData.scheduled_for = scheduled_for
    }

    const { data: announcement, error } = await supabase
      .from('announcements')
      .update(updateData)
      .eq('id', announcementId)
      .select()
      .single()

    if (error) {
      console.error('Error updating announcement:', error)
      return NextResponse.json(
        { error: 'Failed to update announcement' },
        { status: 500 }
      )
    }

    return NextResponse.json({ announcement })
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Update announcement error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/teacher/classrooms/[id]/announcements/[announcementId] - Delete announcement
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; announcementId: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: classroomId, announcementId } = await params

    const ownership = await verifyAnnouncementOwnership(user.id, classroomId, announcementId)
    if (!ownership.ok) {
      return NextResponse.json(
        { error: ownership.error },
        { status: ownership.status }
      )
    }

    if (ownership.isArchived) {
      return NextResponse.json(
        { error: 'Classroom is archived' },
        { status: 403 }
      )
    }

    const supabase = getServiceRoleClient()

    const { error } = await supabase
      .from('announcements')
      .delete()
      .eq('id', announcementId)

    if (error) {
      console.error('Error deleting announcement:', error)
      return NextResponse.json(
        { error: 'Failed to delete announcement' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Delete announcement error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
