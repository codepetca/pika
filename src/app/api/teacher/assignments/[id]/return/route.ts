import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { appendAssignmentFeedbackEntry } from '@/lib/server/assignment-feedback'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/return - Return graded work to students
export const POST = withErrorHandler('PostTeacherAssignmentReturn', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  const { student_ids } = body

  if (!Array.isArray(student_ids) || student_ids.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }

  if (student_ids.length > 100) {
    return NextResponse.json({ error: 'Cannot return more than 100 students at once' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()

  // Verify teacher owns this assignment
  const { data: assignment, error: assignmentError } = await supabase
    .from('assignments')
    .select('*, classrooms!inner(teacher_id)')
    .eq('id', id)
    .single()

  if (assignmentError || !assignment) {
    return NextResponse.json({ error: 'Assignment not found' }, { status: 404 })
  }

  if (assignment.classrooms.teacher_id !== user.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const { data: docs, error: docsError } = await supabase
    .from('assignment_docs')
    .select('*')
    .eq('assignment_id', id)
    .in('student_id', student_ids)

  if (docsError) {
    console.error('Error loading docs for return:', docsError)
    return NextResponse.json({ error: 'Failed to load docs for return' }, { status: 500 })
  }

  const eligibleDocs = (docs || []).filter((doc) =>
    doc.score_completion != null
    && doc.score_thinking != null
    && doc.score_workflow != null
  )

  const now = new Date().toISOString()
  if (eligibleDocs.length > 0) {
    const { error: updateError } = await supabase
      .from('assignment_docs')
      .update({
        returned_at: now,
        feedback_returned_at: now,
      })
      .eq('assignment_id', id)
      .in('student_id', eligibleDocs.map((doc) => doc.student_id))

    if (updateError) {
      console.error('Error returning assignment docs:', updateError)
      return NextResponse.json({ error: 'Failed to return docs' }, { status: 500 })
    }

    await Promise.all(
      eligibleDocs
        .filter((doc) => typeof doc.teacher_feedback_draft === 'string' && doc.teacher_feedback_draft.trim())
        .map((doc) =>
          appendAssignmentFeedbackEntry({
            assignmentId: id,
            studentId: doc.student_id,
            createdBy: user.id,
            entryKind: 'grading_feedback',
            body: doc.teacher_feedback_draft.trim(),
            returnedAt: now,
          })
        )
    )

    await Promise.all(
      eligibleDocs
        .filter((doc) => typeof doc.teacher_feedback_draft === 'string' && doc.teacher_feedback_draft.trim())
        .map((doc) =>
          supabase
            .from('assignment_docs')
            .update({
              feedback: doc.teacher_feedback_draft.trim(),
            })
            .eq('id', doc.id)
        )
    )
  }

  const returnedCount = eligibleDocs.length
  const skippedCount = Math.max(student_ids.length - returnedCount, 0)

  return NextResponse.json({
    returned_count: returnedCount,
    skipped_count: skippedCount,
  })
})
