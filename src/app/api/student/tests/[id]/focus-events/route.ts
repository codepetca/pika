import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { summarizeQuizFocusEvents } from '@/lib/quizzes'
import { assertStudentCanAccessTest } from '@/lib/server/tests'
import { getServiceRoleClient } from '@/lib/supabase'
import type { QuizFocusEventType } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ALLOWED_EVENT_TYPES: QuizFocusEventType[] = [
  'away_start',
  'away_end',
  'route_exit_attempt',
]

// POST /api/student/tests/[id]/focus-events - log focus telemetry for tests
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole('student')
    const { id: testId } = await params
    const body = await request.json()

    const eventType = body?.event_type as QuizFocusEventType | undefined
    const sessionId = String(body?.session_id || '').trim()

    if (!eventType || !ALLOWED_EVENT_TYPES.includes(eventType)) {
      return NextResponse.json(
        { error: 'event_type must be one of away_start, away_end, route_exit_attempt' },
        { status: 400 }
      )
    }

    if (!sessionId || sessionId.length > 120) {
      return NextResponse.json(
        { error: 'session_id is required and must be <= 120 characters' },
        { status: 400 }
      )
    }

    const access = await assertStudentCanAccessTest(user.id, testId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }
    const test = access.test

    const supabase = getServiceRoleClient()

    if (test.status !== 'active') {
      return NextResponse.json(
        { error: 'Focus telemetry is only available while the test is active' },
        { status: 400 }
      )
    }

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

    const { data: existingResponses, error: existingResponsesError } = await supabase
      .from('test_responses')
      .select('id')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .limit(1)

    if (existingResponsesError) {
      console.error('Error checking existing test responses:', existingResponsesError)
      return NextResponse.json({ error: 'Failed to save focus event' }, { status: 500 })
    }

    if ((existingResponses?.length || 0) > 0) {
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
        session_id: sessionId,
        event_type: eventType,
        metadata: body?.metadata && typeof body.metadata === 'object' ? body.metadata : null,
      })

    if (insertError) {
      console.error('Error inserting test focus event:', insertError)
      return NextResponse.json({ error: 'Failed to save focus event' }, { status: 500 })
    }

    const { data: events, error: eventsError } = await supabase
      .from('test_focus_events')
      .select('event_type, occurred_at')
      .eq('test_id', testId)
      .eq('student_id', user.id)
      .order('occurred_at', { ascending: true })

    if (eventsError) {
      console.error('Error reading test focus events:', eventsError)
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({
      success: true,
      focus_summary: summarizeQuizFocusEvents(events || []),
    })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Test focus event POST error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
