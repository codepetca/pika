import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { calculateAssignmentStatus } from '@/lib/assignments'
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

// GET /api/teacher/assignments/[id]/students/[studentId] - Get specific student's work
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; studentId: string }> }
) {
  try {
    const user = await requireRole('teacher')
    const { id: assignmentId, studentId } = await params
    const supabase = getServiceRoleClient()

    // Fetch assignment and verify ownership
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select(`
        *,
        classrooms!inner (
          id,
          teacher_id,
          title
        )
      `)
      .eq('id', assignmentId)
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

    // Verify student is enrolled
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('classroom_enrollments')
      .select(`
        student_id,
        users!inner (
          id,
          email
        )
      `)
      .eq('classroom_id', assignment.classroom_id)
      .eq('student_id', studentId)
      .single()

    if (enrollmentError || !enrollment) {
      return NextResponse.json(
        { error: 'Student not found in classroom' },
        { status: 404 }
      )
    }

    // Get student profile for name
    const { data: profile } = await supabase
      .from('student_profiles')
      .select('first_name, last_name')
      .eq('user_id', studentId)
      .single()

    const studentName = profile
      ? `${profile.first_name} ${profile.last_name}`
      : null

    // Get assignment doc
    const { data: doc } = await supabase
      .from('assignment_docs')
      .select('*')
      .eq('assignment_id', assignmentId)
      .eq('student_id', studentId)
      .single()

    // Parse content if it's a string (for backwards compatibility)
    if (doc) {
      doc.content = parseContentField(doc.content)
    }

    const status = calculateAssignmentStatus(assignment, doc)

    return NextResponse.json({
      assignment: {
        id: assignment.id,
        classroom_id: assignment.classroom_id,
        title: assignment.title,
        description: assignment.description,
        due_at: assignment.due_at,
        position: assignment.position ?? 0,
        created_by: assignment.created_by,
        created_at: assignment.created_at,
        updated_at: assignment.updated_at
      },
      classroom: assignment.classrooms,
      student: {
        id: studentId,
        email: (enrollment.users as unknown as { id: string; email: string }).email,
        name: studentName
      },
      doc: doc || null,
      status
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
    console.error('Get student work error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
