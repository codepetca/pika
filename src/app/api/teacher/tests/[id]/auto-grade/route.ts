import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest, validateSelectedTestStudentEnrollment } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  createOrResumeTestAiGradingRun,
  type TestAiGradingNoopSummary,
} from '@/lib/server/test-ai-grading-runs'
import { withErrorHandler } from '@/lib/api-handler'
import { startTestAutoGradeSchema } from '@/lib/validations/test-grading'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function buildNoopResponse(summary: TestAiGradingNoopSummary) {
  return NextResponse.json(
    {
      mode: 'noop',
      summary,
    },
    { status: 200 },
  )
}

// POST /api/teacher/tests/[id]/auto-grade - Preflight test AI grading and create/resume a background run
export const POST = withErrorHandler('PostTeacherTestAutoGrade', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const { studentIds, promptGuidelineOverride, gradeScope } = startTestAutoGradeSchema.parse(
    await request.json(),
  )

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const supabase = getServiceRoleClient()
  const enrollmentValidation = await validateSelectedTestStudentEnrollment(
    supabase,
    access.test.classroom_id,
    studentIds,
  )

  if (!enrollmentValidation.ok) {
    console.error('Error validating selected students for test auto-grade:', enrollmentValidation.error)
    return NextResponse.json({ error: 'Failed to validate selected students' }, { status: 500 })
  }

  if (enrollmentValidation.missingStudentIds.length > 0) {
    return NextResponse.json(
      { error: 'One or more selected students are not enrolled in this classroom' },
      { status: 400 },
    )
  }

  const runResult = await createOrResumeTestAiGradingRun({
    testId,
    teacherId: user.id,
    studentIds,
    promptGuidelineOverride,
    gradeScope,
  })

  if (runResult.kind === 'noop') {
    return buildNoopResponse(runResult.summary)
  }

  if (runResult.kind === 'conflict') {
    return NextResponse.json(
      {
        error: 'Another test AI grading run is already active',
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
