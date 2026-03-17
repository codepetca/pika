import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { isMissingTestAttemptReturnColumnsError } from '@/lib/server/tests'
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
      .order('position', { ascending: true })
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
  if (classroomTestIds.length > 0) {
    type AttemptRow = { test_id: string; is_submitted: boolean; returned_at: string | null }
    let attempts: AttemptRow[] | null = null
    let attemptsError: { code?: string; message?: string; details?: string; hint?: string } | null = null

    {
      const latestAttemptsResult = await supabase
        .from('test_attempts')
        .select('test_id, is_submitted, returned_at')
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
        .map((attempt) => ({ ...attempt, returned_at: null }))
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

  const respondedClosedTests = (closedTests || []).filter((test) =>
    respondedTestIds.has(test.id)
  )

  const allTests = [...(activeTests || []), ...respondedClosedTests]

  const testsWithStatus = allTests.map((test: Quiz) => {
    const hasResponded = respondedTestIds.has(test.id)
    const isReturned = returnedTestIds.has(test.id)
    const studentStatus = getStudentTestStatus(test, hasResponded, isReturned)

    return {
      ...test,
      assessment_type: 'test' as const,
      documents: normalizeTestDocuments((test as { documents?: unknown }).documents),
      student_status: studentStatus,
    }
  })

  // Keep response key as `quizzes` for current UI component compatibility.
  return NextResponse.json({ quizzes: testsWithStatus })
})
