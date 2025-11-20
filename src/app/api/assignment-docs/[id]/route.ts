import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

// GET /api/assignment-docs/[id] - Get assignment doc (creates if doesn't exist)
// The [id] here is the assignment_id, not the doc id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = await params
    const supabase = getServiceRoleClient()

    // Get assignment and verify student is enrolled
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', assignmentId)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      )
    }

    // Verify enrollment
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', assignment.classroom_id)
      .eq('student_id', user.id)
      .single()

    if (enrollmentError || !enrollment) {
      return NextResponse.json(
        { error: 'Not enrolled in this classroom' },
        { status: 403 }
      )
    }

    // Get or create assignment doc
    let { data: doc, error: docError } = await supabase
      .from('assignment_docs')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', user.id)
      .single()

    // Create doc if it doesn't exist (lazy creation)
    if (docError && docError.code === 'PGRST116') {
      const { data: newDoc, error: createError } = await supabase
        .from('assignment_docs')
        .insert({
          assignment_id: assignmentId,
          student_id: user.id,
          content: '',
          is_submitted: false
        })
        .select()
        .single()

      if (createError) {
        console.error('Error creating assignment doc:', createError)
        return NextResponse.json(
          { error: 'Failed to create assignment doc' },
          { status: 500 }
        )
      }
      doc = newDoc
    } else if (docError) {
      console.error('Error fetching assignment doc:', docError)
      return NextResponse.json(
        { error: 'Failed to fetch assignment doc' },
        { status: 500 }
      )
    }

    return NextResponse.json({ assignment, doc })
  } catch (error: any) {
    console.error('Get assignment doc error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}

// PATCH /api/assignment-docs/[id] - Save content (autosave)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = await params
    const body = await request.json()
    const { content } = body

    if (content === undefined) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      )
    }

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

    // Upsert assignment doc (create if doesn't exist, update if exists)
    const { data: doc, error } = await supabase
      .from('assignment_docs')
      .upsert({
        assignment_id: assignmentId,
        student_id: user.id,
        content
      }, {
        onConflict: 'assignment_id,student_id'
      })
      .select()
      .single()

    if (error) {
      console.error('Error saving assignment doc:', error)
      return NextResponse.json(
        { error: 'Failed to save' },
        { status: 500 }
      )
    }

    return NextResponse.json({ doc })
  } catch (error: any) {
    console.error('Save assignment doc error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}
