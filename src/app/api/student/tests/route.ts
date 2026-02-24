import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { getStudentQuizStatus } from '@/lib/quizzes'
import type { Quiz } from '@/types'

export const dynamic = 'force-dynamic'
export const revalidate = 0

// GET /api/student/tests?classroom_id=xxx - List tests for student
export async function GET(request: NextRequest) {
  try {
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
    if (classroomTestIds.length > 0) {
      const { data: attempts, error: attemptsError } = await supabase
        .from('test_attempts')
        .select('test_id, is_submitted')
        .eq('student_id', user.id)
        .in('test_id', classroomTestIds)

      if (attemptsError && attemptsError.code !== 'PGRST205') {
        console.error('Error fetching submitted test attempts:', attemptsError)
        return NextResponse.json({ error: 'Failed to fetch tests' }, { status: 500 })
      }

      for (const attempt of attempts || []) {
        if (attempt.is_submitted) {
          respondedTestIds.add(attempt.test_id)
        }
      }

      const { data: allResponses } = await supabase
        .from('test_responses')
        .select('test_id')
        .eq('student_id', user.id)
        .in('test_id', classroomTestIds)

      for (const response of allResponses || []) {
        respondedTestIds.add(response.test_id)
      }
    }

    const respondedClosedTests = (closedTests || []).filter((test) =>
      respondedTestIds.has(test.id)
    )

    const allTests = [...(activeTests || []), ...respondedClosedTests]

    const testsWithStatus = allTests.map((test: Quiz) => {
      const hasResponded = respondedTestIds.has(test.id)
      const studentStatus = getStudentQuizStatus(test, hasResponded)

      return {
        ...test,
        assessment_type: 'test' as const,
        student_status: studentStatus,
      }
    })

    // Keep response key as `quizzes` for current UI component compatibility.
    return NextResponse.json({ quizzes: testsWithStatus })
  } catch (error: any) {
    if (error.name === 'AuthenticationError') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (error.name === 'AuthorizationError') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    console.error('Get student tests error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
