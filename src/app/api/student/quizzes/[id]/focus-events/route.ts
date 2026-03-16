import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/student/quizzes/[id]/focus-events - focus telemetry is tests-only
export const POST = withErrorHandler('PostStudentQuizFocusEvent', async (request, context) => {
  await requireRole('student')
  await context.params

  return NextResponse.json(
    { error: 'Focus telemetry is only available for tests' },
    { status: 400 }
  )
})
