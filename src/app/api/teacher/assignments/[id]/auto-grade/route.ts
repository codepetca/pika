import { NextResponse } from 'next/server'
import { hasGradableAssignmentSubmission } from '@/lib/ai-grading'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { parseContentField } from '@/lib/tiptap-content'
import { submissionArtifactsToAssignmentArtifacts } from '@/lib/assignment-submission-requirements'
import {
  createOrResumeAssignmentAiGradingRun,
  gradeAssignmentDocWithAi,
  markAssignmentDocMissingGrade,
} from '@/lib/server/assignment-ai-grading-runs'
import { isGradexAssignmentGradingEnabled } from '@/lib/server/gradex-assignment-grading'
import { loadAssignmentSubmissionArtifactsForDoc } from '@/lib/server/assignment-submission-artifacts'
import { validateClassroomStudentIds } from '@/lib/server/classroom-enrollment-validation'
import { assertTeacherCanMutateAssignment } from '@/lib/server/repo-review'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/auto-grade - AI grade selected students
export const POST = withErrorHandler('PostTeacherAssignmentAutoGrade', async (request, context) => {
  const user = await requireRole('teacher')
  const { id } = await context.params
  const body = await request.json()
  const student_ids = Array.isArray(body?.student_ids)
    ? body.student_ids.filter((studentId: unknown): studentId is string => typeof studentId === 'string')
    : []
  const normalizedStudentIds: string[] = Array.from(new Set(student_ids))

  if (normalizedStudentIds.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }

  if (normalizedStudentIds.length > 100) {
    return NextResponse.json({ error: 'Cannot auto-grade more than 100 students at once' }, { status: 400 })
  }

  const assignment = await assertTeacherCanMutateAssignment(user.id, id)
  const supabase = getServiceRoleClient()
  const enrollmentValidation = await validateClassroomStudentIds(
    supabase,
    assignment.classroom_id,
    normalizedStudentIds,
  )

  if (!enrollmentValidation.ok) {
    console.error('Error validating enrollments for auto-grade:', enrollmentValidation.error)
    return NextResponse.json({ error: 'Failed to validate student enrollment' }, { status: 500 })
  }

  if (enrollmentValidation.missingStudentIds.length > 0) {
    return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 400 })
  }

  const shouldUseBackgroundRun =
    normalizedStudentIds.length > 1 || isGradexAssignmentGradingEnabled()

  if (shouldUseBackgroundRun) {
    const runResult = await createOrResumeAssignmentAiGradingRun({
      assignmentId: id,
      teacherId: user.id,
      studentIds: normalizedStudentIds,
    })

    if (runResult.kind === 'conflict') {
      return NextResponse.json(
        {
          error: 'Another assignment AI grading run is already active',
          mode: 'background',
          run: runResult.run,
        },
        { status: 409 },
      )
    }

    return NextResponse.json(
      {
        mode: 'background',
        run: runResult.run,
      },
      { status: 202 },
    )
  }

  const studentId = normalizedStudentIds[0]
  const { data: doc, error: docError } = await supabase
    .from('assignment_docs')
    .select('id, student_id, content, feedback, authenticity_score')
    .eq('assignment_id', id)
    .eq('student_id', studentId)
    .maybeSingle()

  if (docError) {
    console.error('Error fetching docs for auto-grade:', docError)
    return NextResponse.json({ error: 'Failed to fetch student docs' }, { status: 500 })
  }

  if (!doc) {
    await markAssignmentDocMissingGrade({
      supabase,
      assignmentId: id,
      studentId,
      gradedBy: user.id,
    })
    return NextResponse.json({
      graded_count: 1,
      skipped_count: 0,
      errors: undefined,
    })
  }

  const studentWork = parseContentField(doc.content)
  const submissionArtifacts = submissionArtifactsToAssignmentArtifacts(
    await loadAssignmentSubmissionArtifactsForDoc(supabase, doc.id)
  )
  if (!hasGradableAssignmentSubmission(studentWork, submissionArtifacts)) {
    await markAssignmentDocMissingGrade({
      supabase,
      assignmentId: id,
      studentId,
      gradedBy: user.id,
    })
    return NextResponse.json({
      graded_count: 1,
      skipped_count: 0,
      errors: undefined,
    })
  }

  try {
    await gradeAssignmentDocWithAi({
      supabase,
      assignment,
      assignmentDoc: doc,
      gradedBy: user.id,
      telemetry: {
        operation: 'single_grade',
        requestedStrategy: 'single',
        resolvedStrategy: 'single',
        studentId,
      },
    })
  } catch (gradingError) {
    return NextResponse.json({
      graded_count: 0,
      skipped_count: 1,
      errors: [gradingError instanceof Error ? `${studentId}: ${gradingError.message}` : `${studentId}: Auto-grade failed`],
    })
  }

  return NextResponse.json({
    graded_count: 1,
    skipped_count: 0,
    errors: undefined,
  })
})
