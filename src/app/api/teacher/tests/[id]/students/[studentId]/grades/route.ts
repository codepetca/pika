import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { saveStudentTestGrades } from '@/lib/server/test-grades'
import { saveStudentTestGradesSchema } from '@/lib/validations/test-grading'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/teacher/tests/[id]/students/[studentId]/grades - Save open-response grades for one student
export const PATCH = withErrorHandler('BulkSaveTeacherTestGrades', async (request, context) => {
  const user = await requireRole('teacher')
  const { id: testId, studentId } = await context.params
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = saveStudentTestGradesSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid grade payload' },
      { status: 400 },
    )
  }

  const result = await saveStudentTestGrades({
    teacherId: user.id,
    testId,
    studentId,
    grades: parsed.data.grades,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ saved_count: result.savedCount })
})
