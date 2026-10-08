import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { saveTestResponseGrade } from '@/lib/server/test-grades'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { saveTestResponseGradeSchema } from '@/lib/validations/test-grading'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/tests/[id]/responses/[responseId] - Grade one test response.
export const PATCH = withErrorHandler('GradeTeacherTestResponse', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, responseId } = await context.params
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = saveTestResponseGradeSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid grade payload' },
      { status: 400 },
    )
  }

  const access = await assertTeacherOwnsTest(user.id, testId, { checkArchived: true })
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  if (access.test.status === 'draft') {
    return NextResponse.json({ error: 'Cannot grade a draft test' }, { status: 400 })
  }

  const response = await saveTestResponseGrade({
    teacherId: user.id,
    testId,
    responseId,
    grade: parsed.data,
  })
  return NextResponse.json({ response })
})
