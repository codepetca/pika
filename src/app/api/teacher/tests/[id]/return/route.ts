import { handleContextualTestOwnerGradingRequest } from '@/lib/server/contextual-test-owner-grading'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { returnStudentTestAttempts } from '@/lib/server/test-return'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const returnRequestSchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1).max(100).transform((ids) => [...new Set(ids)]),
})

export const POST = withErrorHandler('ReturnTeacherTest', async (request, context) => {
  const contextual = await handleContextualTestOwnerGradingRequest('return', request, context.params)
  if (contextual) return contextual
  const user = await requireRole('teacher')
  const { id: testId } = await context.params
  const parsed = returnRequestSchema.safeParse(await request.json())
  if (!parsed.success) return NextResponse.json({ error: 'student_ids must contain 1 to 100 student UUIDs' }, { status: 400 })
  const result = await returnStudentTestAttempts({ testId, teacherId: user.id, studentIds: parsed.data.student_ids })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.counts)
})
