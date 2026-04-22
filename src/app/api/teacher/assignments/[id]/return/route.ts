import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { appendAssignmentFeedbackEntry } from '@/lib/server/assignment-feedback'
import { withErrorHandler } from '@/lib/api-handler'
import { isMissingAssignmentTeacherClearedAtColumnError } from '@/lib/server/assignments'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function hasReturnableAssignmentGrade(doc: {
  score_completion: number | null
  score_thinking: number | null
  score_workflow: number | null
  is_submitted?: boolean | null
  returned_at?: string | null
}) {
  const hasFullGrade = doc.score_completion != null
    && doc.score_thinking != null
    && doc.score_workflow != null

  if (!hasFullGrade) return false

  return !!doc.is_submitted || !doc.returned_at
}

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

  const loadedDocs = docs || []
  const clearableDocs = loadedDocs.filter((doc) => doc.is_submitted)
  const eligibleDocs = loadedDocs.filter(hasReturnableAssignmentGrade)
  const eligibleDocIds = new Set(eligibleDocs.map((doc) => doc.id))
  const actionableDocIds = new Set(
    loadedDocs
      .filter((doc) => doc.is_submitted || eligibleDocIds.has(doc.id) || !!doc.returned_at)
      .map((doc) => doc.id),
  )
  const ungradedDocs = clearableDocs.filter((doc) => !eligibleDocIds.has(doc.id))

  const now = new Date().toISOString()
  let mailboxTrackingAvailable = true

  if (eligibleDocs.length > 0) {
    let updateError = await updateAssignmentDocsForStudents({
      supabase,
      assignmentId: id,
      studentIds: eligibleDocs.map((doc) => doc.student_id),
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
        studentIds: eligibleDocs.map((doc) => doc.student_id),
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

  if (ungradedDocs.length > 0) {
    let reopenError = await updateAssignmentDocsForStudents({
      supabase,
      assignmentId: id,
      studentIds: ungradedDocs.map((doc) => doc.student_id),
      values: {
        is_submitted: false,
        ...(mailboxTrackingAvailable ? { teacher_cleared_at: now } : {}),
      },
    })

    if (isMissingAssignmentTeacherClearedAtColumnError(reopenError)) {
      mailboxTrackingAvailable = false
      reopenError = await updateAssignmentDocsForStudents({
        supabase,
        assignmentId: id,
        studentIds: ungradedDocs.map((doc) => doc.student_id),
        values: {
          is_submitted: false,
        },
      })
    }

    if (reopenError) {
      console.error('Error reopening ungraded assignment docs:', reopenError)
      return NextResponse.json({ error: 'Failed to clear assignment mailbox' }, { status: 500 })
    }
  }

  const returnedCount = eligibleDocs.length
  const clearedCount = clearableDocs.length
  const missingCount = Math.max(student_ids.length - actionableDocIds.size, 0)

  return NextResponse.json({
    returned_count: returnedCount,
    cleared_count: clearedCount,
    missing_count: missingCount,
    mailbox_tracking_available: mailboxTrackingAvailable,
  })
})
