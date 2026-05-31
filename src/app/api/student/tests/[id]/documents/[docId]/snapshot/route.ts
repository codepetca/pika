import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-handler'
import { getServiceRoleClient } from '@/lib/supabase'
import {
  assertStudentCanAccessTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityState,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
} from '@/lib/server/tests'
import { buildSnapshotResponse, findTestDocument } from '@/lib/server/test-document-snapshots'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const GET = withErrorHandler('GetStudentTestDocumentSnapshot', async (_request, context) => {
  const user = await requireRole('student')
  const { id: testId, docId } = await context.params

  const access = await assertStudentCanAccessTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  if (access.test.status === 'draft') {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  const supabase = getServiceRoleClient()
  type AttemptRow = {
    is_submitted: boolean
    returned_at: string | null
    closed_for_grading_at: string | null
  }
  let attempt: AttemptRow | null = null
  let attemptError: { code?: string; message?: string; details?: string; hint?: string } | null = null

  {
    const attemptResult = await supabase
      .from('test_attempts')
      .select('is_submitted, returned_at, closed_for_grading_at')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .maybeSingle()

    attempt = (attemptResult.data as AttemptRow | null) || null
    attemptError = attemptResult.error
  }

  if (
    attemptError &&
    (isMissingTestAttemptReturnColumnsError(attemptError) ||
      isMissingTestAttemptClosureColumnsError(attemptError))
  ) {
    const legacyAttemptResult = await supabase
      .from('test_attempts')
      .select('is_submitted')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .maybeSingle()

    attempt = legacyAttemptResult.data
      ? {
          ...(legacyAttemptResult.data as { is_submitted: boolean }),
          returned_at: null,
          closed_for_grading_at: null,
        }
      : null
    attemptError = legacyAttemptResult.error
  }

  if (attemptError && attemptError.code !== 'PGRST205') {
    console.error('Error checking student test snapshot access:', attemptError)
    return NextResponse.json({ error: 'Failed to fetch test access' }, { status: 500 })
  }

  const { data: responses, error: responsesError } = await supabase
    .from('test_responses')
    .select('selected_option, response_text')
    .eq('test_id', testId)
    .eq('student_id', user.id)

  if (responsesError) {
    console.error('Error checking student test snapshot responses:', responsesError)
    return NextResponse.json({ error: 'Failed to fetch test access' }, { status: 500 })
  }

  const isLockedForGrading = Boolean(attempt?.closed_for_grading_at)
  const hasSubmitted = Boolean(attempt?.is_submitted) || (!isLockedForGrading && hasAnyMeaningfulTestResponse(responses))
  const availabilityResult = await getTestStudentAvailabilityState(supabase, testId, user.id)
  if (availabilityResult.error && !availabilityResult.missingTable) {
    console.error('Error checking student test snapshot availability:', availabilityResult.error)
    return NextResponse.json({ error: 'Failed to fetch test access' }, { status: 500 })
  }

  const accessState = getEffectiveStudentTestAccess({
    testStatus: access.test.status,
    accessState: availabilityResult.state,
    hasSubmitted,
    returnedAt: attempt?.returned_at || null,
    isLockedForGrading,
  })
  if (!accessState.can_start_or_continue && !accessState.can_view_submitted) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  const doc = findTestDocument(access.test, docId)
  if (!doc || doc.source !== 'link' || !doc.snapshot_path) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
  }

  return buildSnapshotResponse(doc)
})
