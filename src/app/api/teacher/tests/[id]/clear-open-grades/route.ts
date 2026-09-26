import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/lib/api-handler'
import { requireRole } from '@/lib/auth'
import { clearTestOpenResponseGrades } from '@/lib/server/test-grades'
import { assertTeacherOwnsTest } from '@/lib/server/tests'
import { clearTestOpenGradesSchema } from '@/lib/validations/test-grading'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/teacher/tests/[id]/clear-open-grades - Clear selected open-response grades.
export const POST = withErrorHandler('ClearTestOpenResponseGrades', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = clearTestOpenGradesSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid clear payload' },
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

  const result = await clearTestOpenResponseGrades({
    teacherId: user.id,
    testId,
    studentIds: parsed.data.student_ids,
    expectedResponses: parsed.data.responses,
  })
  return NextResponse.json({
    cleared_students: result.clearedStudents,
    skipped_students: result.skippedStudents,
    cleared_responses: result.clearedResponses,
  })
})
