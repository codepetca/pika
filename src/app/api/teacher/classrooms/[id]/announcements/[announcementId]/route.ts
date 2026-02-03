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
    const { title, content } = body as { title?: string; content?: string }

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

    // Build update object
    const updates: Record<string, string> = {}
    if (title !== undefined) {
      if (!title.trim()) {
        return NextResponse.json(
          { error: 'Title cannot be empty' },
          { status: 400 }
        )
      }
      updates.title = title.trim()
    }
    if (content !== undefined) {
      if (!content.trim()) {
        return NextResponse.json(
          { error: 'Content cannot be empty' },
          { status: 400 }
        )
      }
      updates.content = content.trim()
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    const { data: announcement, error } = await supabase
      .from('announcements')
      .update(updates)
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
