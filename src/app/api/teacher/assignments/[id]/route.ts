import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { calculateAssignmentStatus } from '@/lib/assignments'
import { extractPlainText } from '@/lib/tiptap-content'
import type { TiptapContent } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/assignments/[id] - Get assignment details with all student submissions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const supabase = getServiceRoleClient()

    // Fetch assignment and verify ownership
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        classrooms!inner (
          id,
          teacher_id,
          title,
          archived_at
        )
      `)
      .eq('id', id)
      .single()

    if (assignmentError || !assignment) {
      return NextResponse.json(
        { error: 'Assignment not found' },
        { status: 404 }
      )
    }

    if (assignment.classrooms.teacher_id !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Get all students in classroom with their assignment docs
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('classroom_enrollments')
      .select(`
        student_id,
        users!inner (
          id,
          email
        )
      `)
      .eq('classroom_id', assignment.classroom_id)

    if (enrollmentError) {
      console.error('Error fetching enrollments:', enrollmentError)
      return NextResponse.json(
        { error: 'Failed to fetch students' },
        { status: 500 }
      )
    }

    // Get student profiles for names
    const studentIds = enrollments?.map(e => e.student_id) || []
    const { data: profiles } = await supabase
      .from('student_profiles')
      .select('user_id, first_name, last_name')
      .in('user_id', studentIds)

    const profileMap = new Map(
      profiles?.map(p => [
        p.user_id,
        {
          first_name: p.first_name,
          last_name: p.last_name,
          full_name: `${p.first_name} ${p.last_name}`.trim(),
        },
      ]) || []
    )

    // Get all assignment docs for this assignment
    const { data: docs } = await supabase
      .from('assignment_docs')
      .select('*')
      .eq('assignment_id', id)

    const docMap = new Map(docs?.map(d => [d.student_id, d]) || [])

    // Build student submission list
    const students = (enrollments || []).map(enrollment => {
      const doc = docMap.get(enrollment.student_id)
      const status = calculateAssignmentStatus(assignment, doc)
      // users is a single object due to the foreign key relationship
      const userEmail = (enrollment.users as unknown as { id: string; email: string }).email
      const profile = profileMap.get(enrollment.student_id) || null

      return {
        student_id: enrollment.student_id,
        student_email: userEmail,
        student_first_name: profile?.first_name ?? null,
        student_last_name: profile?.last_name ?? null,
        student_name: profile?.full_name || null,
        status,
        doc: doc || null
      }
    })

    // Sort by name (with email fallback)
    students.sort((a, b) => {
      const nameA = a.student_name || a.student_email
      const nameB = b.student_name || b.student_email
      return nameA.localeCompare(nameB)
    })

    return NextResponse.json({
      assignment: {
        id: assignment.id,
        classroom_id: assignment.classroom_id,
        title: assignment.title,
        description: assignment.description,
        rich_instructions: assignment.rich_instructions,
        due_at: assignment.due_at,
        position: assignment.position ?? 0,
        is_draft: assignment.is_draft ?? false,
        released_at: assignment.released_at ?? null,
        created_by: assignment.created_by,
        created_at: assignment.created_at,
        updated_at: assignment.updated_at
      },
      classroom: assignment.classrooms,
      students
    })
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
    console.error('Get assignment details error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// PATCH /api/teacher/assignments/[id] - Update assignment
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
    const body = await request.json()
    const { title, rich_instructions, due_at } = body

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

    // Build update object
    const updates: Record<string, any> = {}
    if (title !== undefined) updates.title = title.trim()
    if (rich_instructions !== undefined) {
      const instructions: TiptapContent = rich_instructions
      updates.rich_instructions = instructions
      updates.description = extractPlainText(instructions)  // Keep plain text in sync
    }
    if (due_at !== undefined) updates.due_at = due_at

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No updates provided' },
        { status: 400 }
      )
    }

    const { data: assignment, error } = await supabase
      .from('assignments')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Error updating assignment:', error)
      return NextResponse.json(
        { error: 'Failed to update assignment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ assignment })
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
    console.error('Update assignment error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE /api/teacher/assignments/[id] - Delete assignment
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id } = await params
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

    const { error } = await supabase
      .from('assignments')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Error deleting assignment:', error)
      return NextResponse.json(
        { error: 'Failed to delete assignment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ success: true })
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
    console.error('Delete assignment error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
