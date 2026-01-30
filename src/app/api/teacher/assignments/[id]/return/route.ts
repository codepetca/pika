import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/return - Return graded work to students
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const body = await request.json()
    const { student_ids } = body

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
    }

    if (student_ids.length > 100) {
      return NextResponse.json({ error: 'Cannot return more than 100 students at once' }, { status: 400 })
    }

    const supabase = getServiceRoleClient()

    // Verify teacher owns this assignment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('*, classrooms!inner(teacher_id)')
      .eq('id', id)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
    }

    if (assignment.classrooms.teacher_id !== user.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const now = new Date().toISOString()

    // Only return docs that have been graded (graded_at is set)
    const { data: docs, error: fetchError } = await supabase
      .from('assignment_docs')
      .select('id, student_id, graded_at, returned_at')
      .eq('assignment_id', id)
      .in('student_id', student_ids)

    if (fetchError) {
      console.error('Error fetching docs for return:', fetchError)
      return NextResponse.json({ error: 'Failed to fetch student docs' }, { status: 500 })
    }

    const eligibleIds = (docs || [])
      .filter((d) => d.graded_at !== null)
      .map((d) => d.id)

    const skippedCount = student_ids.length - eligibleIds.length

    if (eligibleIds.length > 0) {
      const { error: updateError } = await supabase
        .from('assignment_docs')
        .update({
          returned_at: now,
          is_submitted: false,
        })
        .in('id', eligibleIds)

      if (updateError) {
        console.error('Error returning docs:', updateError)
        return NextResponse.json({ error: 'Failed to return docs' }, { status: 500 })
      }
    }

    return NextResponse.json({
      returned_count: eligibleIds.length,
      skipped_count: skippedCount,
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Return assignment error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
