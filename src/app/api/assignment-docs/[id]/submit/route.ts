import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { isEmpty } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Parse content field from database, handling both JSONB and legacy TEXT columns
 */
function parseContentField(content: any): TiptapContent {
  if (typeof content === 'string') {
    try {
      return JSON.parse(content) as TiptapContent
    } catch {
      return { type: 'doc', content: [] }
    }
  }
  return content as TiptapContent
}

// POST /api/assignment-docs/[id]/submit - Submit assignment
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireRole('student')
    const { id: assignmentId } = params
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

    // Check if doc exists
    const { data: existingDoc, error: docError } = await supabase
      .from('assignment_docs')
      .select('id, student_id, content')
      .eq('assignment_id', assignmentId)
      .eq('student_id', user.id)
      .single()

    if (docError && docError.code === 'PGRST116') {
      return NextResponse.json(
        { error: 'No work to submit. Please save your work first.' },
        { status: 400 }
      )
    }

    if (docError) {
      console.error('Error fetching assignment doc:', docError)
      return NextResponse.json(
        { error: 'Failed to fetch assignment doc' },
        { status: 500 }
      )
    }

    // Parse content if it's a string (for backwards compatibility)
    if (existingDoc) {
      existingDoc.content = parseContentField(existingDoc.content)
    }

    if (!existingDoc || isEmpty(existingDoc.content)) {
      return NextResponse.json(
        { error: 'No work to submit. Please write something first.' },
        { status: 400 }
      )
    }

    // Update to submitted state
    const { data: doc, error } = await supabase
      .from('assignment_docs')
      .update({
        is_submitted: true,
        submitted_at: new Date().toISOString()
      })
      .eq('id', existingDoc.id)
      .select()
      .single()

    if (error) {
      console.error('Error submitting assignment:', error)
      return NextResponse.json(
        { error: 'Failed to submit' },
        { status: 500 }
      )
    }

    // Parse content if it's a string (for backwards compatibility)
    if (doc) {
      doc.content = parseContentField(doc.content)
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
    console.error('Submit assignment error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
