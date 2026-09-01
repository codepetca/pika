import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth'
import { withErrorHandler, ApiError } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import { getTestEditingPolicy } from '@/lib/server/test-editing-policy'

const startedSnapshotSchema = z.object({ questions: z.array(z.unknown()) })

export const dynamic = 'force-dynamic'

export const POST = withErrorHandler('StartStudentTest', async (_request, context) => {
  const user = await requireRole('student')
  const { id: testId } = await context.params
  const access = await assertStudentCanAccessTest(user.id, testId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  // Fail closed on old schemas: the old RPC rejects NULL but never marks Start.
  await getTestEditingPolicy(testId)
  const { data, error } = await getServiceRoleClient().rpc('save_test_attempt_atomic', {
    p_test_id: testId,
    p_student_id: user.id,
    p_responses: null,
  })
  if (error) {
    if (error.code === '42501') throw new ApiError(403, error.message)
    if (error.code === 'P0002') throw new ApiError(404, 'Test not found')
    throw new ApiError(503, 'Unable to start the test. Please try again.')
  }
  const snapshot = startedSnapshotSchema.safeParse(data)
  if (!snapshot.success) throw new ApiError(503, 'Unable to load the started test. Please try again.')
  return NextResponse.json({ started: true, questions: snapshot.data.questions })
})
