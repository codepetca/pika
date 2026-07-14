import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { submitStudentTestAttempt } from '@/lib/server/test-submissions'
import { submitTestResponsesSchema } from '@/lib/validations/test-submissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/student/tests/[id]/respond - Submit all responses
export const POST = withErrorHandler('PostStudentTestRespond', async (request, context) => {
  const user = await requireRole('student')
  const { id: testId } = await context.params
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = submitTestResponsesSchema.safeParse(rawBody)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid response payload' },
      { status: 400 },
    )
  }

  const result = await submitStudentTestAttempt({
    studentId: user.id,
    testId,
    responses: parsed.data.responses,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  return NextResponse.json({ success: true }, { status: 201 })
})
