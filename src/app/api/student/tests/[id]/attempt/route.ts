import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { saveStudentTestAttempt } from '@/lib/server/test-submissions'
import { saveTestAttemptSchema } from '@/lib/validations/test-submissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/student/tests/[id]/attempt - Autosave draft test responses
export const PATCH = withErrorHandler('PatchStudentTestAttempt', async (request, context) => {
  const user = await requireRole('student')
  const { id: testId } = await context.params
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = saveTestAttemptSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid attempt payload' },
      { status: 400 },
    )
  }

  const result = await saveStudentTestAttempt({
    testId,
    studentId: user.id,
    ...parsed.data,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ attempt: result.attempt, historyEntry: result.historyEntry })
})
