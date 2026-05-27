import { NextRequest, NextResponse } from 'next/server'
import { getServiceRoleClient } from '@/lib/supabase'
import { requireRole } from '@/lib/auth'
import { getTodayInToronto } from '@/lib/timezone'
import { assertStudentCanAccessClassroom } from '@/lib/server/classrooms'
import { hasMeaningfulTestResponse } from '@/lib/test-responses'
import { isAssignmentVisibleToStudents } from '@/lib/server/assignments'
import { withErrorHandler } from '@/lib/api-handler'
import {
  getEffectiveStudentTestAccess,
  isMissingTestAttemptClosureColumnsError,
  isMissingTestStudentAvailabilityError,
} from '@/lib/server/tests'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/student/notifications?classroom_id=xxx
 * Returns notification state for the student sidebar:
 * - hasTodayEntry: whether student has saved any content for today
 * - unviewedAssignmentsCount: count of assignments not yet viewed
 */
export const GET = withErrorHandler('GetStudentNotifications', async (request, context) => {
  const user = await requireRole('student')
  const { searchParams } = new URL(request.url)
  const classroomId = searchParams.get('classroom_id')

  if (!classroomId) {
    return NextResponse.json(
      { error: 'classroom_id is required' },
      { status: 400 }
    )
  }

  const supabase = getServiceRoleClient()

  const access = await assertStudentCanAccessClassroom(user.id, classroomId)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status }
    )
  }

  const today = getTodayInToronto()

  // Check if today is a class day
  const { data: classDay, error: classDayError } = await supabase
    .from('class_days')
    .select('is_class_day')
    .eq('classroom_id', classroomId)
    .eq('date', today)
    .maybeSingle()

  if (classDayError) {
    console.error('Error checking class day:', classDayError)
    return NextResponse.json(
      { error: 'Failed to check notifications' },
      { status: 500 }
    )
  }

  // If today is not a class day, no need to check for entry
  const isClassDay = classDay?.is_class_day === true
  let hasTodayEntry = true // Default to true (no pulse) if not a class day

  if (isClassDay) {
    // Check if entry exists for today
    const { data: todayEntry, error: entryError } = await supabase
      .from('entries')
      .select('id')
      .eq('student_id', user.id)
      .eq('classroom_id', classroomId)
      .eq('date', today)
      .maybeSingle()

    if (entryError) {
      console.error('Error checking today entry:', entryError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    hasTodayEntry = todayEntry !== null
  }

  // Get all assignments for this classroom
  const { data: assignments, error: assignmentsError } = await supabase
    .from('assignments')
    .select('id,released_at')
    .eq('classroom_id', classroomId)
    .eq('is_draft', false)

  if (assignmentsError) {
    console.error('Error fetching assignments:', assignmentsError)
    return NextResponse.json(
      { error: 'Failed to check notifications' },
      { status: 500 }
    )
  }

  // Count unviewed assignments
  let unviewedCount = 0
  const assignmentIds = (assignments || [])
    .filter((a: { is_draft?: boolean; released_at?: string | null }) =>
      isAssignmentVisibleToStudents({ is_draft: false, released_at: a.released_at ?? null })
    )
    .map((a: { id: string }) => a.id)

  if (assignmentIds.length > 0) {
    // Get this student's docs for these assignments
    const { data: docs, error: docsError } = await supabase
      .from('assignment_docs')
      .select('assignment_id, viewed_at')
      .eq('student_id', user.id)
      .in('assignment_id', assignmentIds)

    if (docsError) {
      console.error('Error fetching assignment docs:', docsError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    // Build map of assignment_id -> doc
    const docMap = new Map(docs?.map((d) => [d.assignment_id, d]) || [])

    // Count: no doc exists OR doc.viewed_at is null
    for (const assignmentId of assignmentIds) {
      const doc = docMap.get(assignmentId)
      if (!doc || doc.viewed_at === null) {
        unviewedCount++
      }
    }
  }

  async function countActiveUnansweredTests(
    opts?: { tolerateMissingTable?: boolean }
  ): Promise<{ count: number; error: boolean }> {
    const tolerateMissingTable = opts?.tolerateMissingTable === true

    const { data: activeRows, error: activeError } = await supabase
      .from('tests')
      .select('id, status')
      .eq('classroom_id', classroomId)
      .eq('status', 'active')

    if (activeError) {
      if (tolerateMissingTable && activeError.code === 'PGRST205') {
        return { count: 0, error: false }
      }
      console.error('Error fetching tests:', activeError)
      return { count: 0, error: true }
    }

    const activeIds = (activeRows || []).map((row) => row.id)

    if (activeIds.length === 0) {
      return { count: 0, error: false }
    }

    const testResponsesResult = await supabase
      .from('test_responses')
      .select('test_id, selected_option, response_text')
      .eq('student_id', user.id)
      .in('test_id', activeIds)

    const responses =
      (testResponsesResult.data as Array<{ test_id: string; selected_option: unknown; response_text: unknown }> | null) || []
    const responsesError = testResponsesResult.error

    if (responsesError) {
      if (tolerateMissingTable && responsesError.code === 'PGRST205') {
        return { count: 0, error: false }
      }
      console.error('Error fetching test responses:', responsesError)
      return { count: 0, error: true }
    }

    const respondedIds = new Set<string>()
    for (const row of responses || []) {
      if (!hasMeaningfulTestResponse(row)) continue
      respondedIds.add(row.test_id)
    }

    type AttemptRow = {
      test_id: string
      is_submitted: boolean
      closed_for_grading_at: string | null
    }
    let submittedAttempts: AttemptRow[] | null = null
    let attemptsError: { code?: string; message?: string; details?: string | null; hint?: string | null } | null = null

    {
      const latestAttemptsResult = await supabase
        .from('test_attempts')
        .select('test_id, is_submitted, closed_for_grading_at')
        .eq('student_id', user.id)
        .in('test_id', activeIds)

      submittedAttempts = (latestAttemptsResult.data as AttemptRow[] | null) || null
      attemptsError = latestAttemptsResult.error
    }

    if (attemptsError && isMissingTestAttemptClosureColumnsError(attemptsError)) {
      const legacyAttemptsResult = await supabase
        .from('test_attempts')
        .select('test_id, is_submitted')
        .eq('student_id', user.id)
        .in('test_id', activeIds)

      submittedAttempts = ((legacyAttemptsResult.data as Array<{ test_id: string; is_submitted: boolean }> | null) || [])
        .map((attempt) => ({
          ...attempt,
          closed_for_grading_at: null,
        }))
      attemptsError = legacyAttemptsResult.error
    }

    if (attemptsError && attemptsError.code !== 'PGRST205') {
      console.error('Error fetching test_attempts:', attemptsError)
      return { count: 0, error: true }
    }

    const lockedForGradingIds = new Set<string>()
    for (const attempt of submittedAttempts || []) {
      if (attempt.is_submitted && attempt.test_id) {
        respondedIds.add(attempt.test_id)
      }
      if (attempt.closed_for_grading_at && attempt.test_id) {
        lockedForGradingIds.add(attempt.test_id)
      }
    }

    const availabilityByTestId = new Map<string, 'open' | 'closed'>()
    let availabilityRows: Array<{ test_id: string; state: unknown }> | null = null
    let availabilityError: any = null
    try {
      const availabilityResult = await supabase
        .from('test_student_availability')
        .select('test_id, state')
        .eq('student_id', user.id)
        .in('test_id', activeIds)
      availabilityRows = availabilityResult.data
      availabilityError = availabilityResult.error
    } catch (error) {
      availabilityError = error
    }

    const mockMissingAvailability =
      `${availabilityError?.message || availabilityError || ''}`.includes('Unexpected table: test_student_availability')
    if (availabilityError && !isMissingTestStudentAvailabilityError(availabilityError) && !mockMissingAvailability) {
      console.error('Error fetching selected student test access:', availabilityError)
      return { count: 0, error: true }
    }

    for (const row of availabilityRows || []) {
      if (row.state === 'open' || row.state === 'closed') {
        availabilityByTestId.set(row.test_id, row.state)
      }
    }

    return {
      count: (activeRows || []).filter((test) => {
        const access = getEffectiveStudentTestAccess({
          testStatus: 'active',
          accessState: availabilityByTestId.get(test.id) ?? null,
          hasSubmitted: respondedIds.has(test.id),
          returnedAt: null,
          isLockedForGrading: lockedForGradingIds.has(test.id),
        })
        return access.can_start_or_continue
      }).length,
      error: false,
    }
  }

  const activeTestsResult = await countActiveUnansweredTests(
    { tolerateMissingTable: true }
  )
  if (activeTestsResult.error) {
    return NextResponse.json(
      { error: 'Failed to check notifications' },
      { status: 500 }
    )
  }

  // Count unread announcements for this classroom (only published ones)
  let unreadAnnouncementsCount = 0

  const { data: announcements, error: announcementsError } = await supabase
    .from('announcements')
    .select('id')
    .eq('classroom_id', classroomId)
    .or('scheduled_for.is.null,scheduled_for.lte.now()')

  if (announcementsError) {
    console.error('Error fetching announcements:', announcementsError)
    return NextResponse.json(
      { error: 'Failed to check notifications' },
      { status: 500 }
    )
  }

  const announcementIds = announcements?.map((a) => a.id) || []

  if (announcementIds.length > 0) {
    const { data: reads, error: readsError } = await supabase
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', user.id)
      .in('announcement_id', announcementIds)

    if (readsError) {
      console.error('Error fetching announcement reads:', readsError)
      return NextResponse.json(
        { error: 'Failed to check notifications' },
        { status: 500 }
      )
    }

    const readAnnouncementIds = new Set(reads?.map((r) => r.announcement_id) || [])
    unreadAnnouncementsCount = announcementIds.filter((id) => !readAnnouncementIds.has(id)).length
  }

  return NextResponse.json({
    hasTodayEntry,
    unviewedAssignmentsCount: unviewedCount,
    activeTestsCount: activeTestsResult.count,
    unreadAnnouncementsCount,
  })
})
