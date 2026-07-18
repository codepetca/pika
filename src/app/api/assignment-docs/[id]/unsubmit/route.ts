import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { canUnsubmitAssignmentDoc, isAssignmentVisibleToStudents, sanitizeDocForStudent } from '@/lib/assignments'
import { parseContentField } from '@/lib/tiptap-content'
import { withErrorHandler } from '@/lib/api-handler'
import type { TiptapContent } from '@/types'
import { unsubmitAssignmentDocAtomic } from '@/lib/server/assignment-doc-submissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/assignment-docs/[id]/unsubmit - Unsubmit assignment
export const POST = withErrorHandler('PostAssignmentDocUnsubmit', async (request, context) => {
  const user = await requireRole('student')
  const { id: assignmentId } = await context.params
  const supabase = getServiceRoleClient()

  // Get assignment and verify enrollment
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('classroom_id, is_draft, released_at')
    .eq('id', assignmentId)
    .single()

  if (assignmentError || !assignment) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  if (!isAssignmentVisibleToStudents(assignment)) {
    return NextResponse.json(
      { error: 'Assignment not found' },
      { status: 404 }
    )
  }

  const access = await assertStudentCanAccessClassroom(user.id, assignment.classroom_id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    )
  }

  // Fetch doc first to enforce ownership
  const { data: existingDoc, error: docError } = await supabase
    .from('assignment_docs')
    .select('id, student_id, is_submitted, submitted_at, returned_at, teacher_cleared_at')
    .eq('assignment_id', assignmentId)
    .eq('student_id', user.id)
    .single()

  if (docError && docError.code === 'PGRST116') {
    return NextResponse.json(
      { error: 'Assignment doc not found' },
      { status: 404 }
    )
  }

  if (docError) {
    console.error('Error fetching assignment doc:', docError)
    return NextResponse.json(
      { error: 'Failed to fetch assignment doc' },
      { status: 500 }
    )
  }

  if (!existingDoc.is_submitted) {
    return NextResponse.json(
      { error: 'Assignment is not submitted' },
      { status: 400 }
    )
  }

  if (!canUnsubmitAssignmentDoc(existingDoc)) {
    return NextResponse.json(
      { error: 'Returned submissions cannot be unsubmitted' },
      { status: 409 }
    )
  }

  const unsubmitResult = await unsubmitAssignmentDocAtomic({
    supabase,
    assignmentId,
    studentId: user.id,
  })
  if (!unsubmitResult.ok) {
    return NextResponse.json(
      { error: unsubmitResult.error },
      { status: unsubmitResult.status }
    )
  }
  const doc = unsubmitResult.doc

  // Parse content if it's a string (for backwards compatibility)
  if (doc) {
    doc.content = parseContentField(doc.content)
  }

  return NextResponse.json({ doc: sanitizeDocForStudent(doc) })
})
