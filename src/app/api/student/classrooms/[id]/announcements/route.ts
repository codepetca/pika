import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/classrooms/[id]/announcements - List announcements (newest first)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: classroomId } = await params

    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
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
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get announcements error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/student/classrooms/[id]/announcements - Mark all announcements as read
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: classroomId } = await params

    const access = await assertStudentCanAccessClassroom(user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      )
    }

    const supabase = getServiceRoleClient()

    // Get all announcements for this classroom
    const { data: announcements, error: fetchError } = await supabase
      .from('announcements')
      .select('id')
      .eq('classroom_id', classroomId)

    if (fetchError) {
      console.error('Error fetching announcements:', fetchError)
      return NextResponse.json(
        { error: 'Failed to mark announcements as read' },
        { status: 500 }
      )
    }

    if (!announcements || announcements.length === 0) {
      return NextResponse.json({ success: true, marked: 0 })
    }

    // Bulk upsert read records (ignore conflicts)
    const readRecords = announcements.map((a) => ({
      announcement_id: a.id,
      user_id: user.id,
    }))

    const { error: upsertError } = await supabase
      .from('announcement_reads')
      .upsert(readRecords, {
        onConflict: 'announcement_id,user_id',
        ignoreDuplicates: true,
      })

    if (upsertError) {
      console.error('Error marking announcements as read:', upsertError)
      return NextResponse.json(
        { error: 'Failed to mark announcements as read' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true, marked: announcements.length })
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error instanceof Error && error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Mark announcements read error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
