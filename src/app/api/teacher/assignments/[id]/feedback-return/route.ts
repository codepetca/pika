import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, apiErrors } from '@/lib/api-handler'
import { appendAssignmentFeedbackEntry } from '@/lib/server/assignment-feedback'
import { assertTeacherOwnsAssignment } from '@/lib/server/repo-review'
import { getServiceRoleClient } from '@/lib/supabase'

export const POST = withErrorHandler('PostTeacherAssignmentFeedbackReturn', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: assignmentId } = await context.params
  const assignment = await assertTeacherOwnsAssignment(user.id, assignmentId)
  const body = await request.json()
  const studentId = typeof body.student_id === 'string' ? body.student_id : ''

  if (!studentId) {
    throw apiErrors.badRequest('student_id is required')
  }

  const supabase = getServiceRoleClient()
  const { data: enrollment } = await supabase
    .from('classroom_enrollments')
    .select('id')
    .eq('classroom_id', assignment.classroom_id)
    .eq('student_id', studentId)
    .maybeSingle()

  if (!enrollment) {
    throw apiErrors.badRequest('Student is not enrolled in this classroom')
  }

  const { data: existingDoc } = await supabase
    .from('assignment_docs')
    .select('*')
    .eq('assignment_id', assignmentId)
    .eq('student_id', studentId)
    .maybeSingle()

  const feedbackDraft = typeof body.feedback === 'string'
    ? body.feedback.trim()
    : (existingDoc?.teacher_feedback_draft || '').trim()

  if (!feedbackDraft) {
    throw apiErrors.badRequest('Feedback draft is required before returning feedback')
  }

  const now = new Date().toISOString()
  const { data: doc, error: upsertError } = await supabase
    .from('assignment_docs')
    .upsert({
      assignment_id: assignmentId,
      student_id: studentId,
      content: existingDoc?.content || { type: 'doc', content: [] },
      is_submitted: existingDoc?.is_submitted ?? false,
      submitted_at: existingDoc?.submitted_at ?? null,
      feedback: feedbackDraft,
      teacher_feedback_draft: feedbackDraft,
      teacher_feedback_draft_updated_at: now,
      feedback_returned_at: now,
    }, { onConflict: 'assignment_id,student_id' })
    .select('*')
    .single()

  if (upsertError || !doc) {
    throw new Error('Failed to save feedback return')
  }

  const entry = await appendAssignmentFeedbackEntry({
    assignmentId,
    studentId,
    createdBy: user.id,
    entryKind: 'teacher_feedback',
    body: feedbackDraft,
    returnedAt: now,
  })

  return NextResponse.json({
    doc,
    entry,
  })
})
