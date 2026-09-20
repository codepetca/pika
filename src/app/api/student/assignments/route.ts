import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { calculateAssignmentStatus, sanitizeDocForStudent } from '@/lib/assignments'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { withErrorHandler } from '@/lib/api-handler'
import { ApiError } from '@/lib/api-error'
import {
  assertContextualAssignmentRows,
  assertContextualStudentAssignmentDocs,
  authorizeClassroomAssignmentRequest,
} from '@/lib/server/classroom-assignment-access'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/assignments?classroom_id=xxx - List assignments for student
export const GET = withErrorHandler('GetStudentAssignments', async (request, context) => {
  const resolveClassroomId = () => new URL(request.url).searchParams.get('classroom_id')
  const assignmentAccess = await authorizeClassroomAssignmentRequest(resolveClassroomId, {
    legacyRole: 'student',
    permission: 'member',
  })
  const classroomId = resolveClassroomId()

  if (!classroomId) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }

  const supabase = getServiceRoleClient()

  if (assignmentAccess.mode === 'legacy') {
    const access = await assertStudentCanAccessClassroom(assignmentAccess.user.id, classroomId)
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.status }
      )
    }
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

  if (assignmentAccess.mode === 'contextual') {
    assertContextualAssignmentRows(classroomId, assignments, { publishedOnly: true })
  }

  const assignmentIds = assignments?.map((assignment) => assignment.id) || []
  const { data: docs, error: docsError } = await supabase
    .from('assignment_docs')
    .select('*')
    .eq('student_id', assignmentAccess.user.id)
    .in('assignment_id', assignmentIds)

  if (assignmentAccess.mode === 'contextual') {
    if (docsError) throw new ApiError(503, 'Unable to verify student assignment documents')
    assertContextualStudentAssignmentDocs(assignmentAccess.user.id, assignmentIds, docs)
  }

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
