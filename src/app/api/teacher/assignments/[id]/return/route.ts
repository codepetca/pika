import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { appendAssignmentFeedbackEntry } from '@/lib/server/assignment-feedback'
import { withErrorHandler } from '@/lib/api-handler'
import {
  getAssignmentRubricState,
  isAssignmentAlreadyReturnedWithoutResubmission,
} from '@/lib/assignments'
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

async function insertZeroReturnedAssignmentDocsForStudents(opts: {
  supabase: ReturnType<typeof getServiceRoleClient>
  assignmentId: string
  studentIds: string[]
  now: string
  includeTeacherClearedAt: boolean
}) {
  const { supabase, assignmentId, studentIds, now, includeTeacherClearedAt } = opts
  const rows = studentIds.map((studentId) => ({
    assignment_id: assignmentId,
    student_id: studentId,
    content: { type: 'doc', content: [] },
    is_submitted: false,
    submitted_at: null,
    score_completion: 0,
    score_thinking: 0,
    score_workflow: 0,
    feedback: null,
    graded_at: now,
    graded_by: 'teacher',
    returned_at: now,
    feedback_returned_at: now,
    ...(includeTeacherClearedAt ? { teacher_cleared_at: now } : {}),
  }))

  const { error } = await supabase
    .from('assignment_docs')
    .insert(rows)

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
  const blockedDocs = existingDocs.filter((doc) => getAssignmentRubricState(doc) === 'partial')
  const nonPartialDocs = existingDocs.filter((doc) => getAssignmentRubricState(doc) !== 'partial')
  const alreadyReturnedDocs = nonPartialDocs.filter((doc) => isAssignmentAlreadyReturnedWithoutResubmission(doc))
  const returnableDocs = nonPartialDocs.filter((doc) => !isAssignmentAlreadyReturnedWithoutResubmission(doc))
  const existingStudentIds = new Set(existingDocs.map((doc) => doc.student_id))
  const returnableStudentIds = returnableDocs.map((doc) => doc.student_id)
  const alreadyReturnedStudentIds = alreadyReturnedDocs.map((doc) => doc.student_id)
  const blockedStudentIds = blockedDocs.map((doc) => doc.student_id)
  const missingStudentIds = student_ids.filter((studentId) => !existingStudentIds.has(studentId))

  const now = new Date().toISOString()
  let mailboxTrackingAvailable = true
  let createdStudentIds: string[] = []
  let uncreatedMissingStudentIds: string[] = missingStudentIds

  if (returnableDocs.length > 0) {
    let updateError = await updateAssignmentDocsForStudents({
      supabase,
      assignmentId: id,
      studentIds: returnableStudentIds,
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
        studentIds: returnableStudentIds,
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

  if (missingStudentIds.length > 0) {
    const { data: enrollments, error: enrollmentError } = await supabase
      .from('classroom_enrollments')
      .select('student_id')
      .eq('classroom_id', assignment.classroom_id)
      .in('student_id', missingStudentIds)

    if (enrollmentError) {
      console.error('Error loading enrollments for return:', enrollmentError)
      return NextResponse.json({ error: 'Failed to load enrollments for return' }, { status: 500 })
    }

    const enrolledMissingStudentIds = new Set((enrollments || []).map((enrollment) => enrollment.student_id))
    createdStudentIds = missingStudentIds.filter((studentId) => enrolledMissingStudentIds.has(studentId))
    uncreatedMissingStudentIds = missingStudentIds.filter((studentId) => !enrolledMissingStudentIds.has(studentId))

    if (createdStudentIds.length > 0) {
      let insertError = await insertZeroReturnedAssignmentDocsForStudents({
        supabase,
        assignmentId: id,
        studentIds: createdStudentIds,
        now,
        includeTeacherClearedAt: true,
      })

      if (isMissingAssignmentTeacherClearedAtColumnError(insertError)) {
        mailboxTrackingAvailable = false
        insertError = await insertZeroReturnedAssignmentDocsForStudents({
          supabase,
          assignmentId: id,
          studentIds: createdStudentIds,
          now,
          includeTeacherClearedAt: false,
        })
      }

      if (insertError) {
        console.error('Error creating zero returned assignment docs:', insertError)
        return NextResponse.json({ error: 'Failed to create returned docs' }, { status: 500 })
      }
    }
  }

  const returnedStudentIds = [...returnableStudentIds, ...createdStudentIds]
  const returnedCount = returnedStudentIds.length
  const clearedCount = returnedCount
  const blockedCount = blockedDocs.length
  const missingCount = uncreatedMissingStudentIds.length
  const alreadyReturnedCount = alreadyReturnedDocs.length
  const createdCount = createdStudentIds.length

  return NextResponse.json({
    returned_count: returnedCount,
    cleared_count: clearedCount,
    updated_count: returnableDocs.length,
    created_count: createdCount,
    created_student_ids: createdStudentIds,
    returned_student_ids: returnedStudentIds,
    blocked_count: blockedCount,
    blocked_student_ids: blockedStudentIds,
    already_returned_count: alreadyReturnedCount,
    already_returned_student_ids: alreadyReturnedStudentIds,
    missing_count: missingCount,
    missing_student_ids: uncreatedMissingStudentIds,
    mailbox_tracking_available: mailboxTrackingAvailable,
  })
})
