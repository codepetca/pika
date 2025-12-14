import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { isValidTiptapContent } from '@/lib/tiptap-content'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/assignment-docs/[id] - Get assignment doc (creates if doesn't exist)
// The [id] here is the assignment_id, not the doc id
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = params
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

    // Get or create assignment doc for this student
    const { data: existingDoc, error: docError } = await supabase
      .from('assignment_docs')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', user.id)
      .single()

    if (docError) {
      if (docError.code === 'PGRST116') {
        const { data: created, error: createError } = await supabase
          .from('assignment_docs')
          .insert({
            assignment_id: assignmentId,
            student_id: user.id,
            content: { type: 'doc', content: [] },
            is_submitted: false,
            submitted_at: null,
          })
          .select()
          .single()

        if (createError || !created) {
          // If we raced another create, re-fetch.
          if (createError?.code === '23505') {
            const { data: raced } = await supabase
              .from('assignment_docs')
              .select('*')
              .eq('assignment_id', assignmentId)
              .eq('student_id', user.id)
              .single()
            return NextResponse.json({ assignment, doc: raced })
          }

          console.error('Error creating assignment doc:', createError)
          return NextResponse.json(
            { error: 'Failed to create assignment doc' },
            { status: 500 }
          )
        }

        return NextResponse.json({ assignment, doc: created })
      }
      console.error('Error fetching assignment doc:', docError)
      return NextResponse.json(
        { error: 'Failed to fetch assignment doc' },
        { status: 500 }
      )
    }

    return NextResponse.json({ assignment, doc: existingDoc })
  } catch (error: any) {
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Get assignment doc error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH /api/assignment-docs/[id] - Save content (autosave)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = params
    const body = await request.json()
    const { content } = body

    if (content === undefined) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      )
    }

    if (!isValidTiptapContent(content)) {
      return NextResponse.json(
        { error: 'Invalid content format' },
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

    // Fetch doc to enforce ownership and submission rules
    const { data: existingDoc, error: docFetchError } = await supabase
      .from('assignment_docs')
      .select('id, student_id, is_submitted')
      .eq('assignment_id', assignmentId)
      .eq('student_id', user.id)
      .single()

    if (docFetchError) {
      if (docFetchError.code === 'PGRST116') {
        const { data: created, error: createError } = await supabase
          .from('assignment_docs')
          .insert({
            assignment_id: assignmentId,
            student_id: user.id,
            content,
            is_submitted: false,
            submitted_at: null,
          })
          .select()
          .single()

        if (createError || !created) {
          console.error('Error creating assignment doc:', createError)
          return NextResponse.json(
            { error: 'Failed to save' },
            { status: 500 }
          )
        }

        return NextResponse.json({ doc: created })
      }
      console.error('Error fetching assignment doc:', docFetchError)
      return NextResponse.json(
        { error: 'Failed to fetch assignment doc' },
        { status: 500 }
      )
    }

    if (existingDoc.is_submitted) {
      return NextResponse.json(
        { error: 'Cannot edit a submitted document' },
        { status: 403 }
      )
    }

    const { data: doc, error } = await supabase
      .from('assignment_docs')
      .update({
        content
      })
      .eq('id', existingDoc.id)
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
    // Authentication error (401)
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Authorization error (403)
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // All other errors (500)
    console.error('Save assignment doc error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
