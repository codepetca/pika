import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import {
  ASSIGNMENT_SCHEDULE_DUE_DATE_ERROR,
  isScheduledReleaseOnOrBeforeDueDate,
} from '@/lib/assignment-schedule-validation'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/release - Release a draft assignment to students
export const POST = withErrorHandler('PostTeacherAssignmentRelease', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json().catch(() => ({}))
  const releaseAt = body?.release_at as string | undefined
  const supabase = getServiceRoleClient()

  // Fetch assignment and verify ownership
  const { data: existing, error: existingError } = await supabase
    .from('assignments')
    .select(`
      *,
      classrooms!inner (
        teacher_id,
        archived_at
      )
    `)
    .eq('id', id)
    .single()

  if (existingError || !existing) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (existing.classrooms.teacher_id !== user.id) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 403 }
    )
  }

  if (existing.classrooms.archived_at) {
    return NextResponse.json(
      { error: 'Classroom is archived' },
      { status: 403 }
    )
  }

  // Check if already released
  if (!existing.is_draft) {
    return NextResponse.json(
      { error: 'Assignment is already released' },
      { status: 400 }
    )
  }

  let releasedAtIso = new Date().toISOString()
  if (releaseAt !== undefined) {
    const parsed = new Date(releaseAt)
    if (isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: 'Invalid release date' },
        { status: 400 }
      )
    }
    if (parsed <= new Date()) {
      return NextResponse.json(
        { error: 'Release date must be in the future' },
        { status: 400 }
      )
    }
    if (!isScheduledReleaseOnOrBeforeDueDate(parsed, existing.due_at)) {
      return NextResponse.json(
        { error: ASSIGNMENT_SCHEDULE_DUE_DATE_ERROR },
        { status: 400 }
      )
    }
    releasedAtIso = parsed.toISOString()
  }

  // Release the assignment
  const { data: assignment, error } = await supabase
    .from('assignments')
    .update({
      is_draft: false,
      released_at: releasedAtIso
    })
    .eq('id', id)
    .select()
    .single()

  if (error) {
    console.error('Error releasing assignment:', error)
    return NextResponse.json(
      { error: 'Failed to release assignment' },
      { status: 500 }
    )
  }

  return NextResponse.json({ assignment })
})
