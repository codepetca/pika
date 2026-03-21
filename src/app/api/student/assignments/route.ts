import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { calculateAssignmentStatus, sanitizeDocForStudent } from '@/lib/assignments'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/assignments?classroom_id=xxx - List assignments for student
export const GET = withErrorHandler('GetStudentAssignments', async (request, context) => {
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

  const access = await assertStudentCanAccessClassroom(user.id, classroomId)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    )
  }

  const { data: assignments, error } = await supabase
    .from('assignments')
    .select('*')
    .eq('classroom_id', classroomId)
    .eq('is_draft', false)
    .order('due_at', { ascending: true })

  if (error) {
    console.error('Error fetching assignments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch assignments' },
      { status: 500 }
    )
  }

  const assignmentIds = assignments?.map((assignment) => assignment.id) || []
  const { data: docs } = await supabase
    .from('assignment_docs')
    .select('*')
    .eq('student_id', user.id)
    .in('assignment_id', assignmentIds)

  const docMap = new Map(docs?.map((doc) => [doc.assignment_id, doc]) || [])

  const assignmentsWithStatus = (assignments || [])
    .filter((assignment) => isAssignmentVisibleToStudents(assignment))
    .map((assignment) => {
      const doc = docMap.get(assignment.id)

      return {
        ...assignment,
        status: calculateAssignmentStatus(assignment, doc),
        doc: doc ? sanitizeDocForStudent(doc) : null,
      }
    })
    .filter(Boolean)

  return NextResponse.json({ assignments: assignmentsWithStatus })
})
