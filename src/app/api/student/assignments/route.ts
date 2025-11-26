import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { calculateAssignmentStatus } from '@/lib/assignments'

// GET /api/student/assignments?classroom_id=xxx - List assignments for student
export async function GET(request: NextRequest) {
  try {
    const user = await requireRole('student')
    const { searchParams } = new URL(request.url)
    const classroomId = searchParams.get('classroom_id')

    if (!classroomId) {
      return NextResponse.json(
        { error: 'classroom_id is required' },
        { status: 400 }
      )
    }

    const supabase = getServiceRoleClient()

    // Verify student is enrolled in this classroom
    const { data: enrollment, error: enrollmentError } = await supabase
      .from('classroom_enrollments')
      .select('id')
      .eq('classroom_id', classroomId)
      .eq('student_id', user.id)
      .single()

    if (enrollmentError || !enrollment) {
      return NextResponse.json(
        { error: 'Not enrolled in this classroom' },
        { status: 403 }
      )
    }

    // Fetch all assignments for the classroom
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

    // Get student's docs for these assignments
    const assignmentIds = assignments?.map(a => a.id) || []
    const { data: docs } = await supabase
      .from('assignment_docs')
      .select('*')
      .eq('student_id', user.id)
      .in('assignment_id', assignmentIds)

    const docMap = new Map(docs?.map(d => [d.assignment_id, d]) || [])

    // Add status to each assignment
    const assignmentsWithStatus = (assignments || []).map(assignment => {
      const doc = docMap.get(assignment.id)
      const status = calculateAssignmentStatus(assignment, doc)

      return {
        ...assignment,
        status,
        doc: doc || null
      }
    })

    return NextResponse.json({ assignments: assignmentsWithStatus })
  } catch (error: any) {
    console.error('Get student assignments error:', error)
    return NextResponse.json(
      { error: error.message || 'Unauthorized' },
      { status: 401 }
    )
  }
}
