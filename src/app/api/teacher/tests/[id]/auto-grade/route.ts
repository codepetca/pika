import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import {
  createOrResumeTestAiGradingRun,
  type TestAiGradingNoopSummary,
} from '@/lib/server/test-ai-grading-runs'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function normalizeStudentIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []

  return Array.from(
    new Set(
      raw
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map((value) => value.trim()),
    ),
  )
}

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
  const body = await request.json()
  const studentIds = normalizeStudentIds(body?.student_ids)

  if (studentIds.length === 0) {
    return NextResponse.json({ error: 'student_ids array is required' }, { status: 400 })
  }

  if (studentIds.length > 100) {
    return NextResponse.json({ error: 'Cannot auto-grade more than 100 students at once' }, { status: 400 })
  }

  if (Object.prototype.hasOwnProperty.call(body ?? {}, 'prompt_guideline')) {
    if (body.prompt_guideline != null && typeof body.prompt_guideline !== 'string') {
      return NextResponse.json({ error: 'prompt_guideline must be a string' }, { status: 400 })
    }
  }

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  const runResult = await createOrResumeTestAiGradingRun({
    testId,
    teacherId: user.id,
    studentIds,
    promptGuidelineOverride:
      typeof body?.prompt_guideline === 'string' ? body.prompt_guideline : null,
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
