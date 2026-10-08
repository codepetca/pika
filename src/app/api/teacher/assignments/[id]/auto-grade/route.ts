import { logServerError } from '@/lib/server/diagnostics'
import { NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { createOrResumeAssignmentAiGradingRun } from '@/lib/server/assignment-ai-grading-runs'
import { validateClassroomStudentIds } from '@/lib/server/classroom-enrollment-validation'
import { assertTeacherCanMutateAssignment } from '@/lib/server/repo-review'
import {
  assignmentIdSchema,
  assignmentStudentIdsRequestSchema,
} from '@/lib/validations/assignment-identifiers'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/assignments/[id]/auto-grade - Preflight Assignment AI grading and create/resume a durable run
export const POST = withErrorHandler('PostTeacherAssignmentAutoGrade', async (request, context) => {
  const user = await requireRole('teacher')
  const id = assignmentIdSchema.parse((await context.params).id)
  const { studentIds: normalizedStudentIds } = assignmentStudentIdsRequestSchema.parse(
    await request.json(),
  )

  const assignment = await assertTeacherCanMutateAssignment(user.id, id)
  const supabase = getServiceRoleClient()
  const enrollmentValidation = await validateClassroomStudentIds(
    supabase,
    assignment.classroom_id,
    normalizedStudentIds,
  )

  if (!enrollmentValidation.ok) {
    logServerError('grading.assignment_enrollment', enrollmentValidation.error)
    return NextResponse.json({ error: 'Failed to validate student enrollment' }, { status: 500 })
  }

  if (enrollmentValidation.missingStudentIds.length > 0) {
    return NextResponse.json({ error: 'Student is not enrolled in this classroom' }, { status: 400 })
  }

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
})
