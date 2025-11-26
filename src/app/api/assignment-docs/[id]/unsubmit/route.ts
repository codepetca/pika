import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// POST /api/assignment-docs/[id]/unsubmit - Unsubmit assignment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = await params
    const supabase = getServiceRoleClient()

    // Get assignment and verify enrollment
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('classroom_id')
      .eq('id', assignmentId)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      )
    }

    // Verify enrollment
    const { data: enrollment } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', assignment.classroom_id)
      .eq('student_id', user.id)
      .single()

    if (!enrollment) {
      return NextResponse.json(
        { error: 'Not enrolled in this classroom' },
        { status: 403 }
      )
    }

    // Update to unsubmitted state
    const { data: doc, error } = await supabase
      .from('assignment_docs')
      .update({
        is_submitted: false,
        submitted_at: null
      })
      .eq('assignment_id', assignmentId)
      .eq('student_id', user.id)
      .select()
      .single()

    if (error) {
      console.error('Error unsubmitting assignment:', error)
      return NextResponse.json(
        { error: 'Failed to unsubmit' },
        { status: 500 }
      )
    }

    return NextResponse.json({ doc })
  } catch (error: any) {
    console.error('Unsubmit assignment error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}
