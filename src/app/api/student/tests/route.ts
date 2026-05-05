import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import {
  getEffectiveStudentTestAccess,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestAttemptReturnColumnsError,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'
import { getStudentTestStatus } from '@/lib/quizzes'
import { normalizeTestDocuments } from '@/lib/test-documents'
import { hasMeaningfulTestResponse } from '@/lib/test-responses'
import { withErrorHandler } from '@/lib/api-handler'
import type { Quiz } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/tests?classroom_id=xxx - List tests for student
export const GET = withErrorHandler('GetStudentTests', async (request, context) => {
  const user = await requireRole('student')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    return NextResponse.json({ error: 'classroom_id is required' }, { status: 400 })
  }

  const supabase = getServiceRoleClient()

  const access = await assertStudentCanAccessClassroom(user.id, classroomId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  async function fetchByStatus(status: 'active' | 'closed') {
    return supabase
      .from('tests')
      .select('*')
      .eq('classroom_id', classroomId)
      .eq('status', status)
      .order('position', { ascending: false })
  }

  const { data: activeTests, error: activeError } = await fetchByStatus('active')

  if (activeError) {
    if (activeError.code === 'PGRST205') {
      return NextResponse.json({ quizzes: [], migration_required: true })
    }
    console.error('Error fetching active tests:', activeError)
    return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
  }

  const { data: closedTests, error: closedError } = await fetchByStatus('closed')

  if (closedError) {
    console.error('Error fetching closed tests:', closedError)
    // Continue without closed tests
  }

  const classroomTestIds = [
    ...(activeTests || []).map((t) => t.id),
    ...(closedTests || []).map((t) => t.id),
  ]

  const respondedTestIds = new Set<string>()
  const returnedTestIds = new Set<string>()
  const lockedTestIds = new Set<string>()
  const availabilityByTestId = new Map<string, 'open' | 'closed'>()
  if (classroomTestIds.length > 0) {
    type AttemptRow = {
      test_id: string
      is_submitted: boolean
      returned_at: string | null
      closed_for_grading_at: string | null
    }
    let attempts: AttemptRow[] | null = null
    let attemptsError: { code?: string; message?: string; details?: string; hint?: string } | null = null

    {
      const latestAttemptsResult = await supabase
        .from('test_attempts')
        .select('test_id, is_submitted, returned_at, closed_for_grading_at')
        .eq('student_id', user.id)
        .in('test_id', classroomTestIds)

      attempts = (latestAttemptsResult.data as AttemptRow[] | null) || null
      attemptsError = latestAttemptsResult.error
    }

    if (attemptsError && isMissingTestAttemptReturnColumnsError(attemptsError)) {
      const legacyAttemptsResult = await supabase
        .from('test_attempts')
        .select('test_id, is_submitted')
        .eq('student_id', user.id)
        .in('test_id', classroomTestIds)

      attempts = ((legacyAttemptsResult.data as Array<{ test_id: string; is_submitted: boolean }> | null) || [])
        .map((attempt) => ({
          ...attempt,
          returned_at: null,
          closed_for_grading_at: null,
        }))
      attemptsError = legacyAttemptsResult.error
    }

    if (attemptsError && isMissingTestAttemptClosureColumnsError(attemptsError)) {
      const legacyAttemptsResult = await supabase
        .from('test_attempts')
        .select('test_id, is_submitted, returned_at')
        .eq('student_id', user.id)
        .in('test_id', classroomTestIds)

      attempts = ((legacyAttemptsResult.data as Array<{
        test_id: string
        is_submitted: boolean
        returned_at: string | null
      }> | null) || [])
        .map((attempt) => ({
          ...attempt,
          closed_for_grading_at: null,
        }))
      attemptsError = legacyAttemptsResult.error
    }

    if (attemptsError && attemptsError.code !== 'PGRST205') {
      console.error('Error fetching submitted test attempts:', attemptsError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    for (const attempt of attempts || []) {
      if (attempt.is_submitted) {
        respondedTestIds.add(attempt.test_id)
      }
      if (attempt.returned_at) {
        returnedTestIds.add(attempt.test_id)
      }
      if (attempt.closed_for_grading_at) {
        lockedTestIds.add(attempt.test_id)
      }
    }

    // Only query test_responses for tests not already marked responded via test_attempts.
    // Avoids fetching all response content for tests already confirmed submitted.
    const remainingTestIds = classroomTestIds.filter((id) => !respondedTestIds.has(id))

    if (remainingTestIds.length > 0) {
      const { data: allResponses, error: allResponsesError } = await supabase
        .from('test_responses')
        .select('test_id, selected_option, response_text')
        .eq('student_id', user.id)
        .in('test_id', remainingTestIds)

      if (allResponsesError) {
        console.error('Error fetching submitted test responses:', allResponsesError)
        return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
      }

      for (const response of allResponses || []) {
        if (!hasMeaningfulTestResponse(response)) continue
        respondedTestIds.add(response.test_id)
      }
    }
  }

  if (classroomTestIds.length > 0) {
    let availabilityRows: Array<{ test_id: string; state: unknown }> | null = null
    let availabilityError: any = null
    try {
      const availabilityResult = await supabase
        .from('test_student_availability')
        .select('test_id, state')
        .eq('student_id', user.id)
        .in('test_id', classroomTestIds)
      availabilityRows = availabilityResult.data
      availabilityError = availabilityResult.error
    } catch (error) {
      availabilityError = error
    }

    const mockMissingAvailability =
      `${availabilityError?.message || availabilityError || ''}`.includes('Unexpected table: test_student_availability')
    if (availabilityError && !isMissingTestStudentAvailabilityError(availabilityError) && !mockMissingAvailability) {
      console.error('Error fetching selected student test access:', availabilityError)
      return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
    }

    for (const row of availabilityRows || []) {
      if (row.state === 'open' || row.state === 'closed') {
        availabilityByTestId.set(row.test_id, row.state)
      }
    }
  }

  const visibleActiveTests = (activeTests || []).filter((test) => {
    const access = getEffectiveStudentTestAccess({
      testStatus: test.status,
      accessState: availabilityByTestId.get(test.id) ?? null,
      hasSubmitted: respondedTestIds.has(test.id),
      returnedAt: returnedTestIds.has(test.id) ? 'returned' : null,
      isLockedForGrading: lockedTestIds.has(test.id),
    })
    return access.can_start_or_continue || access.can_view_submitted
  })

  const visibleClosedTests = (closedTests || []).filter((test) => {
    const access = getEffectiveStudentTestAccess({
      testStatus: test.status,
      accessState: availabilityByTestId.get(test.id) ?? null,
      hasSubmitted: respondedTestIds.has(test.id),
      returnedAt: returnedTestIds.has(test.id) ? 'returned' : null,
      isLockedForGrading: lockedTestIds.has(test.id),
    })
    return access.can_start_or_continue || access.can_view_submitted
  })

  const allTests = [...visibleActiveTests, ...visibleClosedTests]

  const testsWithStatus = allTests.map((test: Quiz) => {
    const hasResponded = respondedTestIds.has(test.id)
    const isReturned = returnedTestIds.has(test.id)
    const access = getEffectiveStudentTestAccess({
      testStatus: test.status,
      accessState: availabilityByTestId.get(test.id) ?? null,
      hasSubmitted: hasResponded,
      returnedAt: isReturned ? 'returned' : null,
      isLockedForGrading: lockedTestIds.has(test.id),
    })
    const studentStatus =
      (hasResponded || lockedTestIds.has(test.id)) && isReturned && access.effective_access === 'closed'
        ? 'can_view_results'
        : lockedTestIds.has(test.id)
          ? 'responded'
          : getStudentTestStatus(test, hasResponded, isReturned)

    return {
      ...test,
      assessment_type: 'test' as const,
      documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
      student_status: studentStatus,
      access_state: access.access_state,
      effective_access: access.effective_access,
    }
  })

  // Keep response key as `quizzes` for current UI component compatibility.
  return NextResponse.json({ quizzes: testsWithStatus })
})
