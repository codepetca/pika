import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { appendAssignmentFeedbackEntry } from '@/lib/server/assignment-feedback'
import { withErrorHandler } from '@/lib/api-handler'
import { getAssignmentRubricState } from '@/lib/assignments'
import { isMissingAssignmentTeacherClearedAtColumnError } from '@/lib/server/assignments'

export const dynamic = 'force-dynamic'
export const revalidate = 0

async function updateAssignmentDocsForStudents(opts: {
  supabase: ReturnType<typeof getServiceRoleClient>
  assignmentId: string
  studentIds: string[]
  values: Record<string, unknown>
}) {
  const { supabase, assignmentId, studentIds, values } = opts
  const { error } = await supabase
    .from('assignment_docs')
    .update(values)
    .eq('assignment_id', assignmentId)
    .in('student_id', studentIds)

  return error
}

// POST /api/teacher/assignments/[id]/return - Return assignment work to students
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

  const existingDocs = docs || []
  const returnableDocs = existingDocs.filter((doc) => getAssignmentRubricState(doc) !== 'partial')
  const blockedDocs = existingDocs.filter((doc) => getAssignmentRubricState(doc) === 'partial')
  const existingStudentIds = new Set(existingDocs.map((doc) => doc.student_id))
  const returnedStudentIds = returnableDocs.map((doc) => doc.student_id)
  const blockedStudentIds = blockedDocs.map((doc) => doc.student_id)
  const missingStudentIds = student_ids.filter((studentId) => !existingStudentIds.has(studentId))

  const now = new Date().toISOString()
  let mailboxTrackingAvailable = true

  if (returnableDocs.length > 0) {
    let updateError = await updateAssignmentDocsForStudents({
      supabase,
      assignmentId: id,
      studentIds: returnedStudentIds,
      values: {
        is_submitted: false,
        teacher_cleared_at: now,
        returned_at: now,
        feedback_returned_at: now,
      },
    })

    if (isMissingAssignmentTeacherClearedAtColumnError(updateError)) {
      mailboxTrackingAvailable = false
      updateError = await updateAssignmentDocsForStudents({
        supabase,
        assignmentId: id,
        studentIds: returnedStudentIds,
        values: {
          is_submitted: false,
          returned_at: now,
          feedback_returned_at: now,
        },
      })
    }

    if (updateError) {
      console.error('Error returning assignment docs:', updateError)
      return NextResponse.json({ error: 'Failed to return docs' }, { status: 500 })
    }

    await Promise.all(
      returnableDocs
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
      returnableDocs
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

  const returnedCount = returnableDocs.length
  const clearedCount = returnedCount
  const blockedCount = blockedDocs.length
  const missingCount = missingStudentIds.length

  return NextResponse.json({
    returned_count: returnedCount,
    cleared_count: clearedCount,
    returned_student_ids: returnedStudentIds,
    blocked_count: blockedCount,
    blocked_student_ids: blockedStudentIds,
    missing_count: missingCount,
    missing_student_ids: missingStudentIds,
    mailbox_tracking_available: mailboxTrackingAvailable,
  })
})
