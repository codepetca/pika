import { NextResponse } from 'next/server'
import { handleContextualTestLearnerRequest } from '@/lib/server/contextual-test-learner-workflow'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import { savedAttemptSchema, saveStudentTestAttempt } from '@/lib/server/test-submissions'
import { saveTestAttemptSchema } from '@/lib/validations/test-submissions'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// PATCH /api/student/tests/[id]/attempt - Autosave draft test responses
export const PATCH = withErrorHandler('PatchStudentTestAttempt', async (request, context) => {
  const contextual = await handleContextualTestLearnerRequest('save', request, context.params)
  if (contextual) return contextual
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
    return NextResponse.json({ error: result.error, error_code: result.error_code, attempt: result.attempt }, { status: result.status })
  }

  return NextResponse.json({ attempt: result.attempt, historyEntry: result.historyEntry })
})

// Read authoritative draft state after a conflict; never infer an initial revision.
export const GET = withErrorHandler('GetStudentTestAttempt', async (_request, context) => {
  const contextual = await handleContextualTestLearnerRequest('recover', _request, context.params)
  if (contextual) return contextual
  const user = await requireRole('student')
  const { id: testId } = await context.params
  const access = await assertStudentCanAccessTest(user.id, testId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.test.status === 'draft') return NextResponse.json({ error: 'Test not found' }, { status: 404 })
  const { data, error } = await getServiceRoleClient().from('test_attempts')
    .select('id, test_id, student_id, responses, is_submitted, submitted_at, created_at, updated_at, draft_revision')
    .eq('test_id', testId).eq('student_id', user.id).maybeSingle()
  if (error) return NextResponse.json({ error: 'Unable to load the current Test revision' }, { status: 503 })
  if (!data) return NextResponse.json({ attempt: null })
  const parsed = savedAttemptSchema.safeParse(data)
  if (!parsed.success) return NextResponse.json({ error: 'Unable to load the current Test revision' }, { status: 503 })
  return NextResponse.json({ attempt: parsed.data })
})
