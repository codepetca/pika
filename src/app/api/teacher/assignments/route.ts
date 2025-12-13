import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/teacher/assignments?classroom_id=xxx - List assignments for a classroom
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Verify teacher owns this classroom
    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('id')
      .eq('id', classroomId)
      .eq('teacher_id', user.id)
      .single()

    if (classroomError || !classroom) {
      return NextResponse.json(
        { error: 'Classroom not found or unauthorized' },
        { status: 403 }
      )
    }

    // Fetch assignments with submission stats
    const { data: assignments, error } = await supabase
      .from('assignments')
      .select('*')
      .eq('classroom_id', classroomId)
      .order('due_at', { ascending: true })

    if (error) {
      console.error('Error fetching assignments:', error)
      return NextResponse.json(
        { error: 'Failed to fetch assignments' },
        { status: 500 }
      )
    }

    // Get submission stats for each assignment
    const assignmentsWithStats = await Promise.all(
      (assignments || []).map(async (assignment) => {
        // Count total students in classroom
        const { count: totalStudents } = await supabase
          .from('classroom_enrollments')
          .select('*', { count: 'exact', head: true })
          .eq('classroom_id', classroomId)

        // Count submitted docs
        const { data: docs } = await supabase
          .from('assignment_docs')
          .select('is_submitted, submitted_at')
          .eq('assignment_id', assignment.id)
          .eq('is_submitted', true)

        const submitted = docs?.length || 0
        const dueAt = new Date(assignment.due_at)
        const late = docs?.filter(doc =>
          doc.submitted_at && new Date(doc.submitted_at) > dueAt
        ).length || 0

        return {
          ...assignment,
          stats: {
            total_students: totalStudents || 0,
            submitted,
            late
          }
        }
      })
    )

    return NextResponse.json({ assignments: assignmentsWithStats })
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
    console.error('Get assignments error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/teacher/assignments - Create a new assignment
export async function POST(request: NextRequest) {
  try {
    const user = await requireRole('teacher')
    const body = await request.json()
    const { classroom_id, title, description, due_at } = body

    // Validate required fields
    if (!classroom_id) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }
    if (!title || !title.trim()) {
      return NextResponse.json(
        { error: 'Title is required' },
        { status: 400 }
      )
    }
    if (!due_at) {
      return NextResponse.json(
        { error: 'Due date is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Verify teacher owns this classroom
    const { data: classroom, error: classroomError } = await supabase
      .from('classrooms')
      .select('id')
      .eq('id', classroom_id)
      .eq('teacher_id', user.id)
      .single()

    if (classroomError || !classroom) {
      return NextResponse.json(
        { error: 'Classroom not found or unauthorized' },
        { status: 403 }
      )
    }

    // Create assignment
    const { data: assignment, error } = await supabase
      .from('assignments')
      .insert({
        classroom_id,
        title: title.trim(),
        description: description || '',
        due_at,
        created_by: user.id
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating assignment:', error)
      return NextResponse.json(
        { error: 'Failed to create assignment' },
        { status: 500 }
      )
    }

    return NextResponse.json({ assignment }, { status: 201 })
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
    console.error('Create assignment error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
