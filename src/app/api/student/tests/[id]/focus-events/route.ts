import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { summarizeTestFocusEvents } from '@/lib/tests'
import {
  assertStudentCanAccessTest,
  getEffectiveStudentTestAccess,
  getTestStudentAvailabilityState,
} from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import { hasAnyMeaningfulTestResponse } from '@/lib/test-responses'
import { withErrorHandler } from '@/lib/api-handler'
import { postTestFocusEventSchema } from '@/lib/validations/test-focus-events'
import type { Json } from '@/types/database.generated'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// POST /api/student/tests/[id]/focus-events - log focus telemetry for tests
export const POST = withErrorHandler('PostStudentTestFocusEvent', async (request, context) => {
  const user = await requireRole('student')
  const { id: testId } = await context.params
  const input = postTestFocusEventSchema.parse(await request.json())

  const access = await assertStudentCanAccessTest(user.id, testId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }
  const test = access.test

  const supabase = getServiceRoleClient()

  const { data: existingAttempt, error: existingAttemptError } = await supabase
    .from('test_attempts')
    .select('id, is_submitted')
    .eq('test_id', testId)
    .eq('student_id', user.id)
    .maybeSingle()

  if (existingAttemptError && existingAttemptError.code !== 'PGRST205') {
    console.error('Error checking existing test attempt:', existingAttemptError)
    return NextResponse.json({ error: 'Failed to save focus event' }, { status: 500 })
  }

  if (existingAttempt?.is_submitted) {
    return NextResponse.json(
      { error: 'Focus telemetry is only available before submitting the test' },
      { status: 400 }
    )
  }

  const availabilityResult = await getTestStudentAvailabilityState(supabase, testId, user.id)
  if (availabilityResult.error && !availabilityResult.missingTable) {
    console.error('Error fetching student test access for focus event:', availabilityResult.error)
    return NextResponse.json({ error: 'Failed to save focus event' }, { status: 500 })
  }
  const accessState = getEffectiveStudentTestAccess({
    testStatus: test.status,
    accessState: availabilityResult.state,
    hasSubmitted: existingAttempt?.is_submitted === true,
  })

  if (!accessState.can_start_or_continue) {
    if (accessState.access_source !== 'student') {
      return NextResponse.json(
        { error: 'Focus telemetry is only available while the test is active' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Focus telemetry is only available while the test is open for you' },
      { status: 403 }
    )
  }

  const { data: existingResponses, error: existingResponsesError } = await supabase
    .from('test_responses')
    .select('selected_option, response_text')
    .eq('test_id', testId)
    .eq('student_id', user.id)

  if (existingResponsesError) {
    console.error('Error checking existing test responses:', existingResponsesError)
    return NextResponse.json({ error: 'Failed to save focus event' }, { status: 500 })
  }

  if (hasAnyMeaningfulTestResponse(existingResponses)) {
    return NextResponse.json(
      { error: 'Focus telemetry is only available before submitting the test' },
      { status: 400 }
    )
  }

  const { error: insertError } = await supabase
    .from('test_focus_events')
    .insert({
      test_id: testId,
      student_id: user.id,
      session_id: input.session_id,
      event_type: input.event_type,
      metadata: (input.incident_id
        ? {
            ...(input.metadata || {}),
            detector_version: 2,
            incident_id: input.incident_id,
            client_event_id: input.client_event_id,
            client_occurred_at: input.client_occurred_at,
          }
        : input.metadata || null) as Json,
    })

  if (insertError) {
    console.error('Error inserting test focus event:', insertError)
    return NextResponse.json({ error: 'Failed to save focus event' }, { status: 500 })
  }

  const { data: events, error: eventsError } = await supabase
    .from('test_focus_events')
    .select('event_type, session_id, occurred_at, metadata')
    .eq('test_id', testId)
    .eq('student_id', user.id)
    .order('occurred_at', { ascending: true })

  if (eventsError) {
    console.error('Error reading test focus events:', eventsError)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({
    success: true,
    focus_summary: summarizeTestFocusEvents(events || []),
  })
})
